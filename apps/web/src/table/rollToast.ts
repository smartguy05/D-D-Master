import { bareDiceNotation, coverNote, naturalD20, type RollResult } from "@dm/shared";

/** What the roll toast under the dice says (TableScene's RollToast, on /table and /play). */
export interface RollToastView {
  /** "Mara · Stealth" (the notation without a label), or "Mara · secret roll": the TV is a room screen. */
  who: string;
  /** The total, or "?" for a secret roll. */
  total: string;
  /** "1d20+3 → [14] +3", "physical dice", or only the bare dice ("1d20") for a secret roll. */
  detail: string;
  /** A natural 20 or 1 on the kept d20 (never for a secret roll). */
  nat: 20 | 1 | undefined;
  /** " · vs AC 15 (half cover +2)" on an open attack roll in cover, else "". */
  cover: string;
  success: boolean | undefined;
}

/**
 * A secret roll shows no label, modifier, dice values, natural, cover or result: who rolled, the
 * bare dice and "?" (gameplay/dice-modes.md); the label ("Insight: is the mayor lying") and the
 * modifier would tell the room what the DM is checking. The server strips the same for players
 * (projection.ts publicRoll), so a remote /play page reads exactly what the TV does.
 */
export function rollToastView(roll: RollResult): RollToastView {
  if (roll.secret) return { who: `${roll.rollerName} · secret roll`, total: "?", detail: bareDiceNotation(roll.dice), nat: undefined, cover: "", success: undefined };
  const n = naturalD20(roll.dice);
  const kept = roll.dice.filter((d) => !d.dropped).map((d) => d.value);
  const detail = roll.physical ? "physical dice" : `${roll.notation}${kept.length ? ` → [${kept.join(", ")}]` : ""}${roll.modifier ? ` ${roll.modifier > 0 ? "+" : ""}${roll.modifier}` : ""}`;
  return { who: `${roll.rollerName} · ${roll.label || roll.notation}`, total: String(roll.total), detail, nat: n === 20 || n === 1 ? n : undefined, cover: roll.cover ? ` ·${coverNote(roll)}` : "", success: roll.success };
}
