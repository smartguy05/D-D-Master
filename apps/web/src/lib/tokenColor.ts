import type { Monster } from "@dm/shared";
import { dispositionOf, type Disposition } from "../host/disposition";

const COLOR: Record<Disposition, string> = { foe: "#c0392b", ally: "#4caf50", neutral: "#e0a030" };

/** A monster token's colour on the TV and the host Board: foes red, allies green, neutral amber. */
export function monsterColor(m: Partial<Pick<Monster, "ally" | "neutral">>): string {
  return COLOR[dispositionOf({ ally: !!m.ally, neutral: !!m.neutral })];
}
