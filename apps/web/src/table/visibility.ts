import { visibilityOf, type BoardEffect, type GameState, type RollResult } from "@dm/shared";

/**
 * What the TV may show. A monster is shown unless the host/DM hid it (`Monster.hidden`, e.g. an
 * ambush) or its token stands in fog the party has not seen. An ally travelling with the party is
 * shown even in fog (they know where it is). Characters and unknown ids are shown.
 */
export function monsterShownOnTable(state: Pick<GameState, "monsters" | "tokens" | "fog" | "locationId">): (id: string) => boolean {
  const canSee = visibilityOf(state);
  return (id) => {
    const m = state.monsters.find((x) => x.id === id);
    if (!m) return true;
    if (m.hidden) return false;
    if (m.ally && m.follows) return true;
    const t = state.tokens.find((x) => x.entityId === id);
    return !t || canSee(t.x, t.y);
  };
}

/**
 * An effect as the TV may play it: null when it lands on a monster the table can't see; a hidden
 * attacker's id is dropped so no bolt flies from its (secret) position, but the hit still shows.
 */
export function effectForTable(state: Pick<GameState, "monsters" | "tokens" | "fog" | "locationId">, effect: BoardEffect): BoardEffect | null {
  const shown = monsterShownOnTable(state);
  if (effect.targetId && !shown(effect.targetId)) return null;
  if (effect.sourceId && !shown(effect.sourceId)) return { ...effect, sourceId: undefined };
  return effect;
}

/**
 * A roll as the TV may show it (dice tray + toast). A roll by a monster the table can't see (hidden
 * ambusher, or in unseen fog) is shown as a plain DM roll: roller "DM", no label (the toast falls
 * back to the notation), no roller id. The dice and total still show, like a DM rolling in the open,
 * so nothing names or locates the creature. Everything else is returned unchanged.
 */
export function rollForTable(roll: RollResult, state: Pick<GameState, "monsters" | "tokens" | "fog" | "locationId"> | null | undefined): RollResult {
  if (!state || !roll.rollerId || !state.monsters.some((m) => m.id === roll.rollerId)) return roll;
  if (monsterShownOnTable(state)(roll.rollerId)) return roll;
  return { ...roll, rollerName: "DM", label: "", rollerId: undefined };
}
