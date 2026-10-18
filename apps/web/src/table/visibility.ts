import { visibilityOf, type BoardEffect, type GameState } from "@dm/shared";

/**
 * What the TV may show. A monster is shown unless the host/DM hid it (`Monster.hidden`, e.g. an
 * ambush) or its token stands in fog the party has not seen. Characters and unknown ids are shown.
 */
export function monsterShownOnTable(state: Pick<GameState, "monsters" | "tokens" | "fog" | "locationId">): (id: string) => boolean {
  const canSee = visibilityOf(state);
  return (id) => {
    const m = state.monsters.find((x) => x.id === id);
    if (!m) return true;
    if (m.hidden) return false;
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
