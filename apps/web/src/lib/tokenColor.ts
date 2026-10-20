import { attitudeOf, type Attitude, type Monster } from "@dm/shared";

const ATTITUDE_COLOR: Record<Attitude, string> = { hostile: "#c0392b", indifferent: "#e0a030", friendly: "#4caf50" };

/** Attitude colour: hostile red, indifferent amber, friendly green (the TV's colours). */
export function attitudeColor(attitude: Attitude): string {
  return ATTITUDE_COLOR[attitude];
}

/**
 * A monster token's colour on the TV and the host Board, by attitude (attitudeOf). Old monsters
 * without attitude fields derive it from their flags, so foes stay red, allies green, neutral amber.
 */
export function monsterColor(m: Partial<Pick<Monster, "ally" | "neutral" | "attitude" | "attitudeScore">>): string {
  return attitudeColor(attitudeOf(m).attitude);
}
