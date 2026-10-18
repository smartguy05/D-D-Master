import { naturalD20, rollNotation, type BoardEffect, type GameState, type RollResult } from "@dm/shared";
import { newId } from "./ids.js";
import { addLog, addRoll } from "./state.js";
import type { EngineContext, EngineOutcome } from "./tools.js";

/** Roll helpers shared by the engine handlers (tools.ts and rules/*). */

export function makeRoll(
  state: GameState,
  ctx: EngineContext,
  notation: string,
  label: string,
  opts: { rollerId?: string; rollerName?: string; secret?: boolean; dc?: number } = {},
): RollResult {
  const outcome = rollNotation(notation, ctx.rng);
  const roll: RollResult = {
    id: newId("roll"),
    notation: outcome.notation,
    label,
    rollerId: opts.rollerId,
    rollerName: opts.rollerName ?? "DM",
    dice: outcome.dice,
    modifier: outcome.modifier,
    total: outcome.total,
    physical: false,
    secret: opts.secret ?? false,
    dc: opts.dc,
    success: opts.dc !== undefined ? outcome.total >= opts.dc : undefined,
    ts: Date.now(),
  };
  addRoll(state, roll);
  addLog(state, {
    kind: "roll",
    speaker: roll.rollerName,
    text: `${roll.rollerName} rolled ${label || notation}: ${roll.secret ? "(secret)" : roll.total}`,
  });
  return roll;
}

export function effect(e: Omit<BoardEffect, "id" | "ts">): BoardEffect {
  return { id: newId("fx"), ts: Date.now(), ...e };
}

/** A natural 20 or 1 on a visible d20 roll flashes on the roller's token. */
export function rollEffects(roll: RollResult, out: EngineOutcome) {
  if (roll.secret || !roll.rollerId) return;
  const nat = naturalD20(roll.dice);
  if (nat === 20) out.effects.push(effect({ kind: "crit", targetId: roll.rollerId }));
  else if (nat === 1) out.effects.push(effect({ kind: "miss", targetId: roll.rollerId }));
}

export function rollSummary(roll: RollResult) {
  const nat = naturalD20(roll.dice);
  return {
    total: roll.total,
    dice: roll.dice.map((d) => (d.dropped ? `(${d.value})` : d.value)),
    modifier: roll.modifier,
    natural20: nat === 20 || undefined,
    natural1: nat === 1 || undefined,
    success: roll.success,
  };
}
