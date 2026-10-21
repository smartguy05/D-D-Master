import { presentCharacters, type Campaign, type GameState, type Moment, type MomentKind } from "@dm/shared";
import { newId } from "./ids.js";
import { isDead } from "./rules/derive.js";
import { combatFoes, dyingCharacters } from "./turns.js";

/**
 * Table moments (victory, defeat, death, revived, turn_start…): transient events for the TV overlay.
 * Handlers push them into EngineOutcome.moments; GameService.runTool broadcasts them as `moment`
 * events. They are never written into the GameState, the event log or the hub snapshot.
 */

/** Anything that collects moments (EngineOutcome is one). */
export interface MomentSink {
  moments: Moment[];
}

/** Build a moment with a unique id and the current time. */
export function moment(kind: MomentKind, o: Partial<Pick<Moment, "targetId" | "outcome" | "text">> = {}): Moment {
  const m: Moment = { id: newId("mo"), kind, ts: Date.now() };
  if (o.targetId !== undefined) m.targetId = o.targetId;
  if (o.outcome !== undefined) m.outcome = o.outcome;
  if (o.text !== undefined) m.text = o.text;
  return m;
}

/** Foes fought in this combat (in its initiative order) and none is standing; false out of combat. */
export function foesBeaten(state: GameState): boolean {
  const foes = combatFoes(state);
  return foes.length > 0 && foes.every((m) => m.hp <= 0);
}

/** Every PC in the focused scene is at 0 HP (Unconscious, Stable or Dead); false with none. A split-off group's fight is its own. */
export function partyDown(state: GameState): boolean {
  const pcs = presentCharacters(state);
  return pcs.length > 0 && pcs.every((c) => c.hp <= 0);
}

/** Every PC has the Dead condition (Unconscious or Stable PCs can still be saved); false with no PCs. */
export function partyDead(state: GameState): boolean {
  return state.characters.length > 0 && state.characters.every(isDead);
}

/** Ids of the PCs that are dead in `after` but were not in `before`. */
export function newlyDeadPcs(before: GameState, after: GameState): string[] {
  const wasDead = new Set(before.characters.filter(isDead).map((c) => c.id));
  return after.characters.filter((c) => isDead(c) && !wasDead.has(c.id)).map((c) => c.id);
}

/** The campaign's death rule is met by this change: the last PC died (party_wipe) or any PC died (any_death). */
export function deathRuleEnds(rule: Campaign["deathRule"], before: GameState, after: GameState): boolean {
  if (rule === "any_death") return newlyDeadPcs(before, after).length > 0;
  return partyDead(after) && !partyDead(before);
}

/** The death rule is met by the state as it stands (end_campaign failure from the DM needs this). */
export function deathRuleMet(rule: Campaign["deathRule"], state: GameState): boolean {
  return rule === "any_death" ? state.characters.some(isDead) : partyDead(state);
}

const VICTORY_HINT =
  "Every foe is down: the fight is won. Narrate the victory in a sentence or two, then call end_combat with outcome victory (unless more enemies are coming).";

/** The victory hint; while a PC is dying it asks for healing first (death saves need the combat turns). */
export function victoryHint(state: GameState): string {
  const dying = dyingCharacters(state).map((c) => c.name);
  if (!dying.length) return VICTORY_HINT;
  return `Every foe is down, but ${dying.join(" and ")} ${dying.length > 1 ? "are" : "is"} dying. Keep the turns going (death saves happen on their turns) until they are healed or stabilised (heal, a Medicine check, a spell); only then end the fight (end_combat, outcome victory).`;
}

/**
 * After an engine tool (not start_combat/end_combat): announce a victory or a defeat once per
 * combat. Records the kind in combat.announced and, on victory, adds `victory_hint` to an object output
 * (victoryHint: it holds end_combat back while a PC is dying).
 */
export function announceCombatResult(state: GameState, out: MomentSink & { output: unknown }) {
  const combat = state.combat;
  if (!combat.active) return;
  combat.announced ??= []; // a hand-built state (tests, old in-memory states) may lack it
  if (!combat.announced.includes("victory") && foesBeaten(state)) {
    combat.announced.push("victory");
    out.moments.push(moment("victory"));
    if (out.output && typeof out.output === "object" && !Array.isArray(out.output)) out.output = { ...(out.output as object), victory_hint: victoryHint(state) };
  }
  if (!combat.announced.includes("defeat") && partyDown(state)) {
    combat.announced.push("defeat");
    out.moments.push(moment("defeat"));
  }
}
