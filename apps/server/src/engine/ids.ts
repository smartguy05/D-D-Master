import { randomBytes, randomInt } from "node:crypto";
import type { Rng } from "@dm/shared";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

/** Cryptographically strong die roller used for all real rolls. */
export const cryptoRng: Rng = (sides) => randomInt(1, sides + 1);
