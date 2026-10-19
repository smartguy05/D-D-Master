import {
  abilityMod,
  formatMod,
  primaryDamage,
  spellEffectAt,
  type AbilityKey,
  type Character,
  type GameState,
  type SpellDamage,
  type SpellInfo,
  type SpellLevelRow,
  type ToolArgsOf,
} from "@dm/shared";
import { addLog, requireCharacter, requireCombatant } from "../state.js";
import type { EngineContext, EngineOutcome } from "../tools.js";
import { pactText, slotsText } from "./derive.js";
import { endConcentration, isIncapacitating } from "./vitals.js";

/**
 * cast_spell: resolve an SRD spell, spend the right slot and report the numbers the DM needs.
 * - Cantrips are free and scale with character level (Cantrip Upgrade).
 * - Rituals are free only with `as_ritual` (SRD Rules Glossary, Ritual: "The Ritual version of a
 *   spell takes 10 minutes longer to cast than normal. It also doesn't expend a spell slot, which
 *   means the ritual version of a spell can't be cast at a higher level.").
 * - Otherwise exactly one slot of the requested level (default: the spell's level) is spent; there
 *   is no silent fallback to a higher slot. Warlocks spend Pact Magic slots, always at the pact slot
 *   level, and a Mystic Arcanum use for level 6+ spells.
 * - SRD Concentration: "You lose Concentration on an effect the moment you start casting a spell
 *   that requires Concentration".
 * Errors are returned as `{ error, ... }` with the state untouched (no throw), so the DM can fix
 * the call from the message.
 */

const REVIVAL_SPELLS = new Set(["Revivify", "Raise Dead", "Resurrection", "True Resurrection"]);

const MENTAL: AbilityKey[] = ["int", "wis", "cha"];

/** Spellcasting ability: the class's, else the highest of INT/WIS/CHA (non-SRD or non-caster class). */
export function spellcastingAbility(c: Character, ctx: EngineContext): AbilityKey {
  const cls = c.className ? ctx.classData(c.className) : undefined;
  if (cls?.spellcasting) return cls.spellcasting.ability;
  return MENTAL.reduce((best, k) => (c.abilities[k] > c.abilities[best] ? k : best), "int" as AbilityKey);
}

const dmg = (d: SpellDamage, mod: number) => ({ dice: d.addMod ? `${d.dice}${formatMod(mod)}` : d.dice, type: d.type });

const damageText = (list: SpellDamage[], mod: number) =>
  list
    .map((d) => dmg(d, mod))
    .map((d) => `${d.dice}${d.type ? ` ${d.type.charAt(0).toUpperCase()}${d.type.slice(1)}` : ""}`)
    .join(" + ");

/**
 * The phone spell card's table: damage/healing at every slot level from the spell's own level up to
 * the character's highest slot (spell slots or pact slots), flagged when a slot of that level is
 * left. A cantrip gets one row at the character's level. No rows for a spell without numbers.
 */
export function spellLevelRows(c: Character, spell: SpellInfo, ctx: EngineContext): SpellLevelRow[] {
  if (!spell.damage.length && !spell.heal) return [];
  const mod = abilityMod(c.abilities[spellcastingAbility(c, ctx)]);
  const pools = [...c.spellSlots, ...(c.pactSlots ? [c.pactSlots] : [])].filter((p) => p.max > 0);
  const top = spell.level === 0 ? 0 : Math.max(spell.level, ...pools.map((p) => p.level));
  const changes = spell.level > 0 && !!spell.upcast;
  const rows: SpellLevelRow[] = [];
  for (let level = spell.level; level <= (changes ? top : spell.level); level++) {
    const effect = spellEffectAt(spell, { slotLevel: level || undefined, casterLevel: c.level });
    const primary = primaryDamage(effect);
    const darts = effect.projectiles && effect.projectiles > 1 ? `${effect.projectiles}× ` : "";
    const row: SpellLevelRow = { level, available: level === 0 || pools.some((p) => p.level === level && p.used < p.max) };
    if (primary.length) row.damage = darts + damageText(primary, mod);
    if (effect.heal) row.heal = effect.heal.addMod ? `${effect.heal.dice}${formatMod(mod)}` : effect.heal.dice;
    if (effect.extraTargets) row.extraTargets = effect.extraTargets;
    rows.push(row);
  }
  return rows;
}

function onSheet(c: Character, spell: SpellInfo, ctx: EngineContext): boolean {
  return c.spells.some((n) => n.trim().toLowerCase() === spell.name.toLowerCase() || ctx.spell(n)?.name === spell.name);
}

type Spend =
  | { ok: true; castLevel: number; spent: string; apply: (c: Character) => void; slot?: boolean; warning?: string }
  | { ok: false; error: Record<string, unknown> };

function freeSlotLevels(c: Character, min: number): number[] {
  return c.spellSlots.filter((s) => s.level >= min && s.used < s.max).map((s) => s.level);
}

function chooseSlot(c: Character, spell: SpellInfo, a: ToolArgsOf<"cast_spell">): Spend {
  if (spell.level === 0) return { ok: true, castLevel: 0, spent: "cantrip (free)", apply: () => {} };
  if (a.as_ritual) {
    if (!spell.ritual) return { ok: false, error: { error: `${spell.name} is not a Ritual spell; it needs a spell slot.` } };
    if (a.slot_level !== undefined && a.slot_level !== spell.level)
      return { ok: false, error: { error: `A Ritual can't be cast at a higher level: ${spell.name} is level ${spell.level}.` } };
    return { ok: true, castLevel: spell.level, spent: "ritual (free, +10 minutes)", apply: () => {} };
  }
  if (a.slot_level !== undefined && a.slot_level < spell.level)
    return { ok: false, error: { error: `${spell.name} is a level ${spell.level} spell: slot_level must be ${spell.level} or higher.` } };

  // Warlock Pact Magic: every pact slot has the same level and the spell is cast at that level.
  const pact = c.pactSlots;
  const want = a.slot_level ?? spell.level;
  if (pact && spell.level <= pact.level && want <= pact.level) {
    if (pact.used < pact.max)
      return { ok: true, castLevel: pact.level, spent: `pact slot (level ${pact.level})`, slot: true, apply: (x) => void (x.pactSlots!.used += 1) };
    if (!c.spellSlots.some((s) => s.level === want && s.used < s.max))
      return { ok: false, error: { error: `${c.name} has no Pact Magic slots left (${pact.max} at level ${pact.level}); they come back on a Short Rest.` } };
  }
  if (spell.level >= 6) {
    const arcanum = c.resources.find((r) => r.name.toLowerCase() === `mystic arcanum (level ${spell.level})`);
    if (arcanum && !c.spellSlots.some((s) => s.level === want && s.used < s.max)) {
      if (arcanum.used >= arcanum.max) return { ok: false, error: { error: `${c.name} already used the level ${spell.level} Mystic Arcanum; it returns on a Long Rest.` } };
      return {
        ok: true,
        castLevel: spell.level,
        spent: arcanum.name,
        apply: (x) => void (x.resources.find((r) => r.name === arcanum.name)!.used += 1),
        warning: want > spell.level ? `A Mystic Arcanum spell is cast at its own level (${spell.level}), not ${want}.` : undefined,
      };
    }
  }
  const slot = c.spellSlots.find((s) => s.level === want);
  if (!slot || slot.used >= slot.max) {
    const free = freeSlotLevels(c, spell.level);
    const pactFree = pact && pact.used < pact.max && pact.level >= spell.level ? pact.level : undefined;
    return {
      ok: false,
      error: {
        error: `${c.name} has no level ${want} slot free for ${spell.name}.${free.length ? ` Free slot levels: ${free.join(", ")} (pass slot_level).` : " No slots of that level or higher are left."}`,
        free_slots: free,
        pact_slot: pactFree,
      },
    };
  }
  return { ok: true, castLevel: want, spent: `level ${want} slot`, slot: true, apply: (x) => void (x.spellSlots.find((s) => s.level === want)!.used += 1) };
}

export function castSpell(state: GameState, a: ToolArgsOf<"cast_spell">, ctx: EngineContext, out: EngineOutcome) {
  const c = requireCharacter(state, a.caster_id);
  const spell = ctx.spell(a.spell);
  if (!spell) return { error: `No single SRD spell matches "${a.spell}".`, did_you_mean: ctx.spellCandidates(a.spell) };
  if (c.hp <= 0 || c.conditions.some(isIncapacitating)) return { error: `${c.name} can't cast spells right now (at 0 HP or incapacitated).` };
  const targets = (a.target_ids ?? []).map((t) => requireCombatant(state, t).entity);

  const spend = chooseSlot(c, spell, a);
  if (!spend.ok) return spend.error;
  spend.apply(c);
  const warnings = spend.warning ? [spend.warning] : [];
  // SRD Spells, One Spell with a Spell Slot per Turn: "On a turn, you can expend only one spell slot
  // to cast a spell." Warned, not refused (the DM may allow an exception, e.g. Action Surge rulings).
  if (spend.slot && state.combat.active) {
    const now = { round: state.combat.round, turn: state.combat.turnIndex };
    if (c.slotTurn && c.slotTurn.round === now.round && c.slotTurn.turn === now.turn)
      warnings.push(`${c.name} already spent a spell slot this turn. SRD: "On a turn, you can expend only one spell slot to cast a spell."`);
    c.slotTurn = now;
  }

  let ended: string | undefined;
  if (spell.concentration) {
    ended = endConcentration(state, c, `started casting ${spell.name}`);
    c.concentration = { spell: spell.name, since: Date.now() };
  }

  const ability = spellcastingAbility(c, ctx);
  const mod = abilityMod(c.abilities[ability]);
  const effect = spellEffectAt(spell, { slotLevel: spend.castLevel || undefined, casterLevel: c.level });
  const primary = primaryDamage(effect);
  const later = effect.damage.filter((d) => d.role === "later");
  const alternatives = effect.damage.filter((d) => d.role === "or" && !primary.includes(d));

  // Revival spells don't revive by themselves: the DM checks the spell's conditions, then calls revive.
  const deadTargets = REVIVAL_SPELLS.has(spell.name) ? targets.filter((t) => t.conditions.some((x) => x.toLowerCase() === "dead")) : [];
  const hint = deadTargets.length
    ? `If ${spell.name}'s conditions are met, call revive for ${deadTargets.map((t) => `${t.name} (${t.id})`).join(", ")} with the HP the spell gives.`
    : undefined;

  out.cast = { casterId: c.id, spell, castLevel: spend.castLevel, effect, targetIds: targets.map((t) => t.id), x: a.x, y: a.y };
  addLog(state, { kind: "system", text: `${c.name} casts ${spell.name} (${spend.spent})${targets.length ? ` at ${targets.map((t) => t.name).join(", ")}` : ""}` });

  return {
    caster: c.name,
    spell: spell.name,
    level: spell.level,
    cast_level: spend.castLevel,
    spent: spend.spent,
    slots_left: spell.level > 0 && c.spellSlots.length ? slotsText(c) : undefined,
    pact_left: spell.level > 0 && c.pactSlots ? pactText(c) : undefined,
    casting_time: spell.castingTime,
    range: spell.range,
    duration: spell.duration,
    concentration: spell.concentration || undefined,
    ended_concentration: ended,
    save: spell.save ? { ability: spell.save.toUpperCase(), dc: 8 + c.proficiencyBonus + mod } : undefined,
    attack_bonus: spell.attack ? formatMod(c.proficiencyBonus + mod) : undefined,
    damage: primary.length ? primary.map((d) => dmg(d, mod)) : undefined,
    or_damage: alternatives.length ? alternatives.map((d) => dmg(d, mod)) : undefined,
    later_damage: later.length ? later.map((d) => dmg(d, mod)) : undefined,
    heal: effect.heal ? (effect.heal.addMod ? `${effect.heal.dice}${formatMod(mod)}` : effect.heal.dice) : undefined,
    projectiles: effect.projectiles,
    extra_targets: effect.extraTargets || undefined,
    area: spell.area ? { shape: spell.area.shape, sizeFt: spell.area.sizeFt } : undefined,
    targets: targets.length ? targets.map((t) => t.name) : undefined,
    not_on_sheet: onSheet(c, spell, ctx) ? undefined : true,
    summary: spell.summary,
    hint,
    warning: warnings.length ? warnings.join(" ") : undefined,
  };
}
