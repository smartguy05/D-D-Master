import { isAway, type Character, type ConditionMeta, type GameState, type Monster, type ToolArgsOf } from "@dm/shared";

/**
 * Conditions with a source or a duration (bug spell-conditions-outlive-concentration). The names stay
 * in `conditions` (what the TV, phones and the DM read); `conditionMeta` says why each one is there,
 * so ending the caster's concentration, the duration running out or a long rest takes it away again.
 */

type Entity = Character | Monster;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function entities(state: GameState): Entity[] {
  return [...state.characters, ...state.monsters];
}

/** Drop the conditions whose meta matches `expired`, on every creature. Returns "Name: Condition" lines. */
export function removeLinked(state: GameState, expired: (m: ConditionMeta, e: Entity) => boolean): string[] {
  const removed: string[] = [];
  for (const e of entities(state)) {
    const gone = e.conditionMeta.filter((m) => expired(m, e));
    if (!gone.length) continue;
    e.conditionMeta = e.conditionMeta.filter((m) => !gone.includes(m));
    for (const g of gone) {
      // Another source (or a plain add_condition) may still hold the same condition; a creature at
      // 0 HP stays Unconscious (the engine's own, unrecorded source).
      if (e.conditionMeta.some((m) => same(m.name, g.name))) continue;
      if (same(g.name, "unconscious") && e.hp <= 0) continue;
      e.conditions = e.conditions.filter((c) => !same(c, g.name));
      removed.push(`${e.name}: ${g.name}`);
    }
  }
  return removed;
}

/** The meta add_condition records, or undefined for a plain condition. */
export function conditionMetaFor(state: GameState, target: Entity, name: string, a: ToolArgsOf<"add_condition">): ConditionMeta | undefined {
  if (!a.source_spell && !a.caster_id && !a.duration_rounds && !a.until_end_of_turn_of) return undefined;
  const caster = a.caster_id ? state.characters.find((c) => c.id === a.caster_id) : undefined;
  const meta: ConditionMeta = { name, casterId: a.caster_id, spell: a.source_spell };
  // Concentration wins: "Concentration, up to 1 minute" ends with the caster's focus, whatever the duration.
  if (a.source_spell && caster?.concentration && same(caster.concentration.spell, a.source_spell)) meta.until = { kind: "concentration" };
  else if (a.until_end_of_turn_of) {
    // On that creature's own turn it means "until the end of your next turn": the next round's.
    const cur = state.combat.active ? state.combat.order[state.combat.turnIndex]?.entityId : undefined;
    meta.until = { kind: "end_of_turn", entityId: a.until_end_of_turn_of, round: cur === a.until_end_of_turn_of ? state.combat.round + 1 : state.combat.round };
  }
  else if (a.duration_rounds && state.combat.active)
    meta.until = { kind: "rounds", round: state.combat.round + a.duration_rounds, entityId: a.caster_id ?? target.id };
  return meta;
}

export function addConditionMeta(e: Entity, meta: ConditionMeta) {
  e.conditionMeta = [...e.conditionMeta.filter((m) => !(same(m.name, meta.name) && m.casterId === meta.casterId && m.spell === meta.spell)), meta];
}

/** The caster stopped concentrating on `spell`: its linked conditions end. */
export function endLinkedToConcentration(state: GameState, casterId: string, spell: string): string[] {
  return removeLinked(state, (m) => m.until?.kind === "concentration" && m.casterId === casterId && !!m.spell && same(m.spell, spell));
}

/** A creature's turn starts: "rounds" durations ending at it expire. */
export function expireAtTurnStart(state: GameState, entityId: string): string[] {
  const round = state.combat.round;
  return removeLinked(state, (m) => m.until?.kind === "rounds" && m.until.entityId === entityId && (m.until.round ?? 0) <= round);
}

/** A creature's turn ended: "until the end of its turn" effects expire. */
export function expireAtTurnEnd(state: GameState, entityId: string): string[] {
  const round = state.combat.round;
  return removeLinked(state, (m) => m.until?.kind === "end_of_turn" && m.until.entityId === entityId && (m.until.round ?? 0) <= round);
}

/** Timed effects keyed to a creature that can't take turns any more (dead, removed, out of initiative). */
export function expireOrphaned(state: GameState): string[] {
  const acts = (id: string) =>
    state.combat.order.some((o) => o.entityId === id) &&
    (state.characters.some((c) => c.id === id && !c.conditions.some((x) => same(x, "dead"))) || state.monsters.some((m) => m.id === id && m.hp > 0));
  const round = state.combat.round;
  return removeLinked(state, (m, e) => {
    const u = m.until;
    // A PC with a split-off group is in a frozen scene: their timers wait for it.
    if (!u?.entityId || acts(u.entityId) || isAway(state, e.id) || isAway(state, u.entityId)) return false;
    return u.kind === "end_of_turn" || (u.kind === "rounds" && (u.round ?? 0) <= round);
  });
}

/** Combat ended: round- and turn-based effects end with it. */
export function endTimedConditions(state: GameState): string[] {
  return removeLinked(state, (m, e) => !isAway(state, e.id) && (m.until?.kind === "rounds" || m.until?.kind === "end_of_turn"));
}

/** Long rest: spell effects on the rested characters wear off (plain conditions such as Poisoned stay). */
export function endSpellConditionsOnRest(state: GameState, characterIds: string[]): string[] {
  return removeLinked(state, (m, e) => characterIds.includes(e.id) && (!!m.spell || !!m.until));
}

/** remove_condition: forget why it was there too. */
export function dropConditionMeta(e: Entity, name: string) {
  e.conditionMeta = e.conditionMeta.filter((m) => !same(m.name, name));
}
