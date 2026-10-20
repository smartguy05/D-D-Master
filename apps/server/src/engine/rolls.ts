import { coverNote, naturalD20, rollNotation, type BoardEffect, type GameState, type RollResult } from "@dm/shared";
import { newId } from "./ids.js";
import { addLog, addRoll } from "./state.js";
import type { EngineContext, EngineOutcome } from "./tools.js";

/** Roll helpers shared by the engine handlers (tools.ts and rules/*). */

export function makeRoll(
  state: GameState,
  ctx: EngineContext,
  notation: string,
  label: string,
  opts: { rollerId?: string; rollerName?: string; secret?: boolean; dc?: number; attack?: boolean; targetId?: string; cover?: RollResult["cover"] } = {},
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
    source: ctx.source ?? "dm",
    attack: opts.attack ?? false,
    targetId: opts.attack ? opts.targetId : undefined,
    ts: Date.now(),
  };
  if (opts.cover) roll.cover = opts.cover;
  addRoll(state, roll);
  addLog(state, {
    kind: "roll",
    speaker: roll.rollerName,
    text: `${roll.rollerName} rolled ${label || notation}: ${roll.secret ? "(secret)" : `${roll.total}${coverNote(roll)}`}`,
  });
  return roll;
}

/**
 * A d20 roll aimed at a creature is an attack roll, unless its label says it is a save or a check
 * (a save "against" a caster, a Medicine check on an ally): those keep their DC and no AC.
 */
export function isAttackRoll(notation: string, targetId: string | undefined, label = ""): boolean {
  return !!targetId && /d20/i.test(notation) && !/\b(save|saving|check|contest)\b/i.test(label);
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
