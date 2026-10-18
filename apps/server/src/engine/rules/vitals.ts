import { abilityMod, type Character, type GameState, type PendingRollKind, type ToolArgsOf } from "@dm/shared";
import { makeRoll, rollEffects } from "../rolls.js";
import { addLog, requireCharacter } from "../state.js";
import type { EngineContext, EngineOutcome } from "../tools.js";
import { isDead } from "./derive.js";

/**
 * Automatic SRD 5.2.1 rules for player characters: dropping to 0 HP, massive damage, Death Saving
 * Throws, Stable, and Concentration checks. Called from the engine's apply_damage / heal /
 * add_condition / next_turn / record_physical_roll handlers, which mutate the cloned state.
 * Monsters keep the simple rule (0 HP = Dead).
 */

const freshSaves = () => ({ successes: 0, failures: 0, stable: false });

/** Conditions that include Incapacitated (SRD Rules Glossary), which breaks Concentration. */
const INCAPACITATING = ["incapacitated", "unconscious", "paralyzed", "petrified", "stunned", "dead"];

export function isIncapacitating(condition: string): boolean {
  return INCAPACITATING.includes(condition.trim().toLowerCase());
}

function removeCondition(c: Character, name: string) {
  c.conditions = c.conditions.filter((x) => x.toLowerCase() !== name.toLowerCase());
}

function addCondition(c: Character, name: string) {
  if (!c.conditions.some((x) => x.toLowerCase() === name.toLowerCase())) c.conditions.push(name);
}

/** Ends concentration (if any) and returns the spell that ended. */
export function endConcentration(state: GameState, c: Character, why: string): string | undefined {
  const spell = c.concentration?.spell;
  if (!spell) return undefined;
  c.concentration = null;
  addLog(state, { kind: "system", text: `${c.name} loses concentration on ${spell} (${why}).` });
  return spell;
}

function die(state: GameState, c: Character, cause: string) {
  c.hp = 0;
  removeCondition(c, "Unconscious");
  addCondition(c, "Dead");
  c.deathSaves = { successes: 0, failures: 3, stable: false };
  // SRD: "Your Concentration ends if you have the Incapacitated condition or you die."
  endConcentration(state, c, "died");
  addLog(state, { kind: "system", text: `${c.name} dies (${cause}).` });
}

// ---------- pending physical rolls ----------

export interface PhysicalRequest {
  notation: string;
  label: string;
  dc?: number;
  kind: PendingRollKind;
}

/**
 * Ask a physical-dice player for an automatic roll (death save, concentration). There is only one
 * `pendingRoll` slot: if it already holds someone else's roll (or another kind), it is left alone
 * and the DM is told to ask for this roll afterwards and record it with record_physical_roll + kind.
 */
export function requestPhysical(state: GameState, c: Character, req: PhysicalRequest) {
  const p = state.pendingRoll;
  const record = `record_physical_roll with kind=${req.kind}${req.dc !== undefined ? ` dc=${req.dc}` : ""}`;
  if (p && !(p.characterId === c.id && p.kind === req.kind)) {
    const who = state.characters.find((x) => x.id === p.characterId)?.name ?? p.characterId;
    return {
      physical: true,
      queued: false,
      instruction: `${c.name} must also roll ${req.notation} for ${req.label}, but ${who}'s ${p.label} roll is still pending. After that one, ask ${c.name} for it and call ${record}.`,
    };
  }
  state.pendingRoll = { characterId: c.id, notation: req.notation, label: req.label, dc: req.dc, kind: req.kind };
  addLog(state, { kind: "system", text: `${c.name}: roll ${req.notation} for ${req.label} (physical dice)` });
  return {
    physical: true,
    instruction: `${c.playerName || c.name} rolls real dice: ask for ${req.notation} (${req.label}) and the total, then call record_physical_roll.`,
  };
}

/** A human label for a pending roll that request_player_roll is about to replace (automatic kinds only). */
export function replacedPending(state: GameState): string | undefined {
  const p = state.pendingRoll;
  if (!p || p.kind === "check") return undefined;
  const who = state.characters.find((x) => x.id === p.characterId)?.name ?? p.characterId;
  return `${who}'s pending ${p.kind === "death_save" ? "death save" : "concentration save"} was replaced; ask for it again and call record_physical_roll with kind=${p.kind}${p.dc !== undefined ? ` dc=${p.dc}` : ""}.`;
}

// ---------- concentration ----------

function savesProficient(c: Character, ctx: EngineContext, ability: string): boolean {
  const sheet = c.savingThrows.some((s) => s.trim().toLowerCase().startsWith(ability));
  const cls = c.className ? ctx.classData(c.className) : undefined;
  return sheet || !!cls?.savingThrows.includes(ability as never);
}

/** CON save bonus for Concentration: CON mod + PB when proficient (sheet or class saves). */
export function conSaveBonus(c: Character, ctx: EngineContext): number {
  return abilityMod(c.abilities.con) + (savesProficient(c, ctx, "con") ? c.proficiencyBonus : 0);
}

/**
 * SRD Concentration, Damage: "If you take damage, you must succeed on a Constitution saving throw
 * to maintain Concentration. The DC equals 10 or half the damage taken (round down), whichever
 * number is higher, up to a maximum DC of 30."
 */
export function concentrationDc(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

export function concentrationCheck(state: GameState, ctx: EngineContext, c: Character, damage: number, out: EngineOutcome) {
  const spell = c.concentration!.spell;
  const dc = concentrationDc(damage);
  const bonus = conSaveBonus(c, ctx);
  const notation = `1d20${bonus >= 0 ? "+" : ""}${bonus}`;
  const label = `Concentration save (${spell})`;
  if (c.diceMode === "physical") return { spell, dc, ...requestPhysical(state, c, { notation, label, dc, kind: "concentration" }) };
  const roll = makeRoll(state, ctx, notation, label, { rollerId: c.id, rollerName: c.name, dc });
  out.rolls.push(roll);
  rollEffects(roll, out);
  return { spell, dc, roll: roll.total, ...applyConcentrationSave(state, c, roll.total, dc) };
}

export function applyConcentrationSave(state: GameState, c: Character, total: number, dc: number) {
  const kept = total >= dc;
  if (!kept) endConcentration(state, c, `failed DC ${dc} save`);
  return { kept };
}

// ---------- damage, healing ----------

export interface DamageNotes {
  down?: boolean;
  dead?: boolean;
  cause?: string;
  death_saves?: { successes: number; failures: number };
  concentration?: Record<string, unknown>;
  concentration_ended?: string;
}

/**
 * Damage to a player character (temp HP first). SRD 5.2.1 "Dropping to 0 Hit Points":
 * - Massive Damage: "When damage reduces a character to 0 Hit Points and damage remains, the
 *   character dies if the remainder equals or exceeds their Hit Point maximum."
 * - Falling Unconscious: "If you reach 0 Hit Points and don't die instantly, you have the
 *   Unconscious condition ... until you regain any Hit Points".
 * - Damage at 0 Hit Points: "If you take any damage while you have 0 Hit Points, you suffer a Death
 *   Saving Throw failure. If the damage is from a Critical Hit, you suffer two failures instead. If
 *   the damage equals or exceeds your Hit Point maximum, you die."
 * - Stabilizing: "If the creature takes damage, it stops being Stable".
 * Otherwise, damage to a concentrating character triggers a Concentration save.
 */
export function damageCharacter(
  state: GameState,
  ctx: EngineContext,
  c: Character,
  amount: number,
  critical: boolean,
  out: EngineOutcome,
): DamageNotes {
  const notes: DamageNotes = {};
  if (isDead(c) || amount <= 0) return notes;
  let remaining = amount;
  if (c.tempHp > 0) {
    const absorbed = Math.min(c.tempHp, remaining);
    c.tempHp -= absorbed;
    remaining -= absorbed;
  }

  if (c.hp > 0) {
    const before = c.hp;
    c.hp = Math.max(0, c.hp - remaining);
    if (c.hp > 0) {
      if (c.concentration) notes.concentration = concentrationCheck(state, ctx, c, amount, out);
      return notes;
    }
    if (remaining - before >= c.maxHp) {
      die(state, c, "massive damage");
      return { ...notes, dead: true, cause: "massive damage" };
    }
    addCondition(c, "Unconscious");
    c.deathSaves = freshSaves();
    notes.down = true;
    // Unconscious includes Incapacitated, which breaks Concentration.
    const ended = endConcentration(state, c, "dropped to 0 HP");
    if (ended) notes.concentration_ended = ended;
    return notes;
  }

  // Already at 0 HP.
  if (remaining >= c.maxHp) {
    die(state, c, "massive damage");
    return { dead: true, cause: "massive damage" };
  }
  c.deathSaves.stable = false;
  c.deathSaves.failures = Math.min(3, c.deathSaves.failures + (critical ? 2 : 1));
  if (c.deathSaves.failures >= 3) {
    die(state, c, "three failed death saves");
    return { dead: true, cause: "three failed death saves" };
  }
  return { down: true, death_saves: { successes: c.deathSaves.successes, failures: c.deathSaves.failures } };
}

/**
 * After healing. SRD: Unconscious lasts "until you regain any Hit Points", and the death-save counts
 * are "reset to zero when you regain any Hit Points or become Stable".
 */
export function afterHealing(c: Character) {
  if (c.hp <= 0) return;
  c.deathSaves = freshSaves();
}

/** add_condition: an Incapacitating condition breaks Concentration. */
export function afterCondition(state: GameState, c: Character, condition: string): string | undefined {
  return isIncapacitating(condition) ? endConcentration(state, c, condition) : undefined;
}

// ---------- death saving throws ----------

export function needsDeathSave(c: Character): boolean {
  return c.hp <= 0 && !isDead(c) && !c.deathSaves.stable;
}

/**
 * Apply a death save d20. SRD 5.2.1 "Death Saving Throws":
 * "Roll 1d20. If the roll is 10 or higher, you succeed. Otherwise, you fail. ... On your third
 * success, you become Stable ... On your third failure, you die." "When you roll a 1 on the d20 for
 * a Death Saving Throw, you suffer two failures. If you roll a 20 on the d20, you regain 1 Hit
 * Point." Counts are "reset to zero when you regain any Hit Points or become Stable".
 */
export function applyDeathSave(state: GameState, c: Character, natural: number) {
  if (!Number.isInteger(natural) || natural < 1 || natural > 20) throw new Error("A death save is a plain d20: give the number rolled, 1 to 20.");
  if (natural === 20) {
    c.hp = Math.max(1, c.hp);
    removeCondition(c, "Unconscious");
    c.deathSaves = freshSaves();
    addLog(state, { kind: "system", text: `${c.name} rolls a natural 20 on a death save and regains 1 HP!` });
    return { success: true, natural20: true, hp: c.hp, conscious: true };
  }
  const success = natural >= 10;
  if (natural === 1) c.deathSaves.failures += 2;
  else if (success) c.deathSaves.successes += 1;
  else c.deathSaves.failures += 1;
  c.deathSaves.failures = Math.min(3, c.deathSaves.failures);
  if (c.deathSaves.failures >= 3) {
    die(state, c, "three failed death saves");
    return { success: false, natural1: natural === 1 || undefined, failures: 3, dead: true };
  }
  if (c.deathSaves.successes >= 3) {
    c.deathSaves = { successes: 0, failures: 0, stable: true };
    addLog(state, { kind: "system", text: `${c.name} is Stable (still unconscious at 0 HP).` });
    return { success: true, stable: true };
  }
  addLog(state, { kind: "system", text: `${c.name} death save: ${success ? "success" : "failure"} (S${c.deathSaves.successes} F${c.deathSaves.failures})` });
  return { success, natural1: natural === 1 || undefined, successes: c.deathSaves.successes, failures: c.deathSaves.failures };
}

/** Roll (virtual) or request (physical) a death save for a character at 0 HP. */
export function rollDeathSave(state: GameState, ctx: EngineContext, c: Character, out: EngineOutcome) {
  if (isDead(c)) throw new Error(`${c.name} is dead.`);
  if (c.hp > 0) throw new Error(`${c.name} is not at 0 HP.`);
  if (c.deathSaves.stable) return { name: c.name, stable: true, rolled: false, note: "Stable: no death saves needed." };
  const label = "Death saving throw";
  if (c.diceMode === "physical") return { name: c.name, ...requestPhysical(state, c, { notation: "1d20", label, dc: 10, kind: "death_save" }) };
  const roll = makeRoll(state, ctx, "1d20", label, { rollerId: c.id, rollerName: c.name, dc: 10 });
  out.rolls.push(roll);
  rollEffects(roll, out);
  return { name: c.name, roll: roll.total, ...applyDeathSave(state, c, roll.dice[0]?.value ?? roll.total) };
}

// ---------- tools ----------

export function deathSaveTool(state: GameState, a: ToolArgsOf<"death_save">, ctx: EngineContext, out: EngineOutcome) {
  return rollDeathSave(state, ctx, requireCharacter(state, a.character_id), out);
}

/** SRD: "A Stable creature doesn't make Death Saving Throws even though it has 0 Hit Points, but it still has the Unconscious condition." */
export function stabilizeTool(state: GameState, a: ToolArgsOf<"stabilize">) {
  const c = requireCharacter(state, a.character_id);
  if (isDead(c)) throw new Error(`${c.name} is dead.`);
  if (c.hp > 0) throw new Error(`${c.name} is not at 0 HP.`);
  c.deathSaves = { successes: 0, failures: 0, stable: true };
  addCondition(c, "Unconscious");
  if (state.pendingRoll?.characterId === c.id && state.pendingRoll.kind === "death_save") state.pendingRoll = undefined;
  addLog(state, { kind: "system", text: `${c.name} is Stable.` });
  return { name: c.name, stable: true };
}

export function endConcentrationTool(state: GameState, a: ToolArgsOf<"end_concentration">) {
  const c = requireCharacter(state, a.character_id);
  return { name: c.name, ended: endConcentration(state, c, "ended by choice") ?? null };
}

/**
 * record_physical_roll for an automatic roll kind. Returns undefined for a plain check.
 * `kind` is the explicit arg, else the pending roll's kind when it is this character's.
 */
export function recordAutomaticRoll(state: GameState, c: Character, kind: PendingRollKind, total: number, dc: number | undefined) {
  if (kind === "death_save") {
    if (isDead(c)) throw new Error(`${c.name} is dead.`);
    if (c.hp > 0) return { death_save: { ignored: `${c.name} is no longer at 0 HP.` } };
    return { death_save: applyDeathSave(state, c, total) };
  }
  if (kind === "concentration") {
    if (!c.concentration) return { concentration: { ignored: `${c.name} is not concentrating.` } };
    const d = dc ?? 10;
    return { concentration: { spell: c.concentration.spell, dc: d, ...applyConcentrationSave(state, c, total, d) } };
  }
  return undefined;
}
