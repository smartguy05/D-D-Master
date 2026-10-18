import {
  attackStyle,
  damageTypeOf,
  elementFor,
  findAttack,
  naturalD20,
  primaryDamage,
  type AttackOutcome,
  type AttackStyle,
  type BoardEffect,
  type EffectKind,
  type GameState,
  type RollResult,
  type SpellArea,
  type SpellInfo,
} from "@dm/shared";
import { effect } from "./rolls.js";
import { findCombatant, tokenFor } from "./state.js";
import type { EngineContext, SpellCast } from "./tools.js";

/**
 * Automatic board animations for attacks and spells (the TV plays them; nothing is persisted).
 * - An attack roll with a target → one `attack` effect: travel from the attacker (melee swing,
 *   ranged arrow or spell orb) and the outcome (hit/miss/crit) on the target.
 * - apply_damage with a source → its `hit` effect carries the source and style, so it travels too.
 *   The engine has no clock, so repeats are collapsed on the TV: a travel for a source→target pair
 *   that already travelled in the last 1.5 s shows only the landing (apps/web/src/table/effectPlan.ts).
 * - cast_spell → per spell kind (see `castEffects`).
 */

const MAX_PROJECTILES_PER_TARGET = 6;
const MAX_PROJECTILES = 12;
const MAX_RADIUS = 20;

interface AttackInfo {
  style: AttackStyle;
  /** Damage type ("slashing", "fire"...), if known. */
  element?: string;
  label?: string;
  spell?: SpellInfo;
}

/** "Fire Bolt attack" → "Fire Bolt": the label words that aren't part of a weapon/spell name. */
function stripLabel(label: string): string {
  return label
    .replace(/\b(attack|attacks|roll|to hit|hit|spell|ranged|melee)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function spellElement(spell: SpellInfo): string | undefined {
  const t = primaryDamage(spell)[0]?.type;
  return t && t !== "choice" ? t : undefined;
}

function spellInfo(spell: SpellInfo): AttackInfo {
  return { style: "spell", element: spellElement(spell), label: spell.name, spell };
}

/** Token distance in cells between two entities, when both have a token. */
function tokenDistance(state: GameState, a?: string, b?: string): number | undefined {
  const ta = a ? tokenFor(state, a) : undefined;
  const tb = b ? tokenFor(state, b) : undefined;
  return ta && tb ? Math.hypot(ta.x - tb.x, ta.y - tb.y) : undefined;
}

/**
 * What an attacker attacked with, or undefined when nothing names it:
 * - the attacker's matching attack (by attack_name, else named in the label). An entry without SRD
 *   Melee/Ranged text whose name is exactly an SRD spell (a PC's "Fire Bolt" under attacks) is that
 *   spell; otherwise its style comes from attackStyle (description, damage type, distance, name);
 * - else an SRD spell by that name;
 * - else, with `single`, the attacker's only attack.
 */
export function resolveAttack(
  state: GameState,
  ctx: EngineContext,
  attackerId: string | undefined,
  targetId: string | undefined,
  attackName?: string,
  label?: string,
  opts: { single?: boolean } = {},
): AttackInfo | undefined {
  const attacker = attackerId ? findCombatant(state, attackerId)?.entity : undefined;
  const asWeapon = (w: { name: string; description?: string; damage?: string }): AttackInfo => {
    if (!/(melee|ranged)[^.]*attack/i.test(w.description ?? "")) {
      const spell = ctx.spell(w.name);
      if (spell && spell.name.toLowerCase() === w.name.trim().toLowerCase()) return spellInfo(spell);
    }
    const damageType = damageTypeOf(w.damage);
    const style = attackStyle({ name: w.name, description: w.description, damageType, distance: tokenDistance(state, attackerId, targetId) });
    return { style, element: damageType, label: w.name };
  };
  const weapon = attacker ? findAttack(attacker.attacks, attackName, label) : undefined;
  if (weapon) return asWeapon(weapon);
  const spellName = attackName?.trim() || (label ? stripLabel(label) : "");
  const spell = spellName ? ctx.spell(spellName) : undefined;
  if (spell) return spellInfo(spell);
  if (opts.single && attacker?.attacks.length === 1) return asWeapon(attacker.attacks[0]);
  return undefined;
}

/** hit/miss/crit of an attack roll: natural 20 → crit, natural 1 → miss, else success vs the AC (none without a dc). */
export function attackOutcome(roll: Pick<RollResult, "dice" | "success">): AttackOutcome | undefined {
  const nat = naturalD20(roll.dice);
  if (nat === 20) return "crit";
  if (nat === 1) return "miss";
  if (roll.success === undefined) return undefined;
  return roll.success ? "hit" : "miss";
}

/** The `attack` effect for an attack roll against a target, or undefined (no/unknown target, secret roll). */
export function attackRollEffect(
  state: GameState,
  ctx: EngineContext,
  roll: RollResult,
  targetId: string | undefined,
  attackName?: string,
): BoardEffect | undefined {
  if (!targetId || roll.secret) return undefined;
  const target = findCombatant(state, targetId)?.entity;
  if (!target) return undefined;
  // Nothing named: guess from the name words alone (bow, sling... else melee).
  const info = resolveAttack(state, ctx, roll.rollerId, target.id, attackName, roll.label) ?? {
    style: attackStyle({ name: attackName?.trim() || roll.label, distance: tokenDistance(state, roll.rollerId, target.id) }),
    label: attackName?.trim() || undefined,
  };
  return effect({
    kind: "attack",
    style: info.style,
    sourceId: roll.rollerId,
    targetId: target.id,
    element: info.element,
    outcome: attackOutcome(roll),
    label: info.label,
  });
}

/**
 * apply_damage's `hit` effect. With a source whose attack resolves (attack_name, or the source's
 * only attack) it gains the source and travel style. Area spells (Fireball already burst over the
 * area) and unresolved attacks stay a plain hit: no travel is better than a wrong melee swing.
 */
export function damageEffect(
  state: GameState,
  ctx: EngineContext,
  a: { targetId: string; damageType?: string; sourceId?: string; attackName?: string; critical?: boolean },
): BoardEffect {
  const base = { kind: "hit" as const, targetId: a.targetId, element: a.damageType?.toLowerCase() };
  const source = a.sourceId ? findCombatant(state, a.sourceId)?.entity : undefined;
  if (!source) return effect(base);
  const info = resolveAttack(state, ctx, source.id, a.targetId, a.attackName, undefined, { single: true });
  if (!info) return effect(base);
  if (info.spell?.area && !info.spell.attack) return effect({ ...base, label: info.label });
  return effect({
    ...base,
    element: base.element ?? info.element,
    sourceId: source.id,
    style: info.style,
    label: info.label,
    outcome: a.critical ? "crit" : undefined,
  });
}

/**
 * Area size in cells (5 ft each) as one radius: sphere/emanation/cylinder radius ft/5; a cube or a
 * cone as a circle of half its side/length; a line as half its width (min 1). Max 20.
 */
export function areaRadiusCells(area: SpellArea): number {
  if (area.shape === "line") return Math.max(1, (area.widthFt ?? 5) / 10);
  const ft = area.shape === "cube" || area.shape === "cone" ? area.sizeFt / 2 : area.sizeFt;
  return Math.min(MAX_RADIUS, Math.round((ft / 5) * 10) / 10);
}

/**
 * Darts over targets round-robin (at most 6 per target, 12 in total). Never 0: with fewer darts
 * than targets only the first `projectiles` targets get one (the result is shorter than `targets`).
 */
export function projectileSplit(projectiles: number, targets: number): number[] {
  const total = Math.min(MAX_PROJECTILES, Math.max(0, projectiles));
  const n = Math.min(targets, total);
  return Array.from({ length: n }, (_, i) => Math.min(MAX_PROJECTILES_PER_TARGET, Math.floor(total / n) + (i < total % n ? 1 : 0)));
}

/** The element burst EffectKind for a damage type (single-target save spells). */
export function burstKind(damageType: string | undefined): EffectKind {
  const e = elementFor(damageType);
  const map: Partial<Record<typeof e, EffectKind>> = {
    fire: "fireball",
    cold: "frost",
    lightning: "lightning",
    thunder: "thunder",
    acid: "poison",
    poison: "poison",
    radiant: "radiant",
    necrotic: "necrotic",
    force: "arcane",
    psychic: "arcane",
  };
  return map[e] ?? "slash";
}

/**
 * Effects for a resolved cast_spell:
 * - spell attack (Fire Bolt, Scorching Ray) or darts without an attack roll (Magic Missile): an orb
 *   per target, `count` = darts split over the targets;
 * - area (Fireball, Cone of Cold): one `area` burst at x/y, else the first target, else the caster
 *   (emanations always on the caster). A line with targets flies an orb to each target instead;
 * - other damaging spells (Sacred Flame): an element burst on each target;
 * - healing: heal on each target (else the caster); anything else: an arcane sparkle on the
 *   targets (else the caster).
 */
export function castEffects(cast: SpellCast): BoardEffect[] {
  const { spell, casterId, targetIds } = cast;
  const element = spellElement(spell);
  const label = spell.name;
  const projectiles = cast.effect.projectiles ?? spell.projectiles;
  // A spell attack's orb only travels (the attack roll that follows brings hit/miss/crit); darts
  // without an attack roll (Magic Missile) always hit.
  const outcome = spell.attack ? undefined : ("hit" as const);
  const orbs = (counts?: number[]) =>
    (counts ? targetIds.slice(0, counts.length) : targetIds).map((t, i) =>
      effect({ kind: "attack", style: "spell", sourceId: casterId, targetId: t, element, label, count: counts?.[i], outcome }),
    );

  if (spell.attack || (projectiles && targetIds.length && !spell.save)) {
    if (targetIds.length) return orbs(projectiles && projectiles > 1 ? projectileSplit(projectiles, targetIds.length) : undefined);
    return cast.x !== undefined && cast.y !== undefined ? [effect({ kind: "attack", style: "spell", sourceId: casterId, x: cast.x, y: cast.y, element, label })] : [];
  }
  if (spell.area) {
    if (spell.area.shape === "line" && targetIds.length) return orbs();
    const at =
      spell.area.shape === "emanation"
        ? { targetId: casterId }
        : cast.x !== undefined && cast.y !== undefined
          ? { x: cast.x, y: cast.y }
          : { targetId: targetIds[0] ?? casterId };
    return [effect({ kind: "area", style: "area", sourceId: casterId, ...at, radius: areaRadiusCells(spell.area), shape: spell.area.shape, element, label })];
  }
  const onTargets = (kind: EffectKind, extra: Partial<BoardEffect> = {}) =>
    (targetIds.length ? targetIds : [casterId]).map((t) => effect({ kind, targetId: t, label, ...extra }));
  if (primaryDamage(cast.effect).length && targetIds.length) return onTargets(burstKind(element), { sourceId: casterId, style: "spell", element });
  if (cast.effect.heal) return onTargets("heal");
  return onTargets("arcane");
}
