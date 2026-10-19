import { naturalD20, type RollResult } from "@dm/shared";

export type Flourish = "crit" | "fumble";

/**
 * The full-screen flourish for a roll as the table shows it: natural 20 → crit, natural 1 → fumble.
 * Virtual and physical rolls alike (a physical roll carries its spoken natural as the kept d20).
 * Secret rolls and rolls without exactly one kept d20 (damage, plain d20+d20 sums) get none.
 */
export function flourishFor(roll: Pick<RollResult, "dice" | "secret">): Flourish | undefined {
  if (roll.secret) return undefined;
  const nat = naturalD20(roll.dice);
  return nat === 20 ? "crit" : nat === 1 ? "fumble" : undefined;
}

/** How long the flourish stays on screen. */
export const FLOURISH_MS = 2200;
