import { visibilityOf, type BoardEffect, type GameState, type MapFeature, type MapObject, type Moment, type RollResult } from "@dm/shared";

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

/**
 * A moment as the TV may play it: null for a death, revival, turn banner or attitude flash of a
 * monster the table can't see (hidden ambusher, or in unseen fog), so no banner names it. Moments about characters,
 * shown monsters, or nobody (victory, defeat, fled, campaign end) are returned unchanged.
 */
export function momentForTable(state: Pick<GameState, "monsters" | "tokens" | "fog" | "locationId">, moment: Moment): Moment | null {
  if (!moment.targetId) return moment;
  if (moment.kind !== "death" && moment.kind !== "revived" && moment.kind !== "turn_start" && moment.kind !== "attitude") return moment;
  return monsterShownOnTable(state)(moment.targetId) ? moment : null;
}

/** The initiative order the TV may show (battle intro): monsters the table can't see are left out. */
export function initiativeForTable(state: Pick<GameState, "combat" | "monsters" | "tokens" | "fog" | "locationId">): GameState["combat"]["order"] {
  const seen = monsterShownOnTable(state);
  return state.combat.order.filter((o) => o.entityType !== "monster" || seen(o.entityId));
}

type MapObjectView = Pick<GameState, "fog" | "locationId">;

/**
 * Whether the TV draws a map object (loot marker or interactable aura): not when the DM/host hid
 * it, not when it belongs to another location, and not while its cell is in unrevealed fog.
 */
export function mapObjectShownOnTable(state: MapObjectView): (obj: MapObject) => boolean {
  const canSee = visibilityOf(state);
  return (obj) => !obj.hidden && obj.locationId === state.locationId && canSee(obj.x, obj.y);
}

/** Whether the TV draws an aura on a map feature: only interactive ones with at least one visible cell. */
export function interactiveFeatureShownOnTable(state: MapObjectView): (f: MapFeature) => boolean {
  const canSee = visibilityOf(state);
  return (f) => {
    if (!f.interactive) return false;
    for (let dx = 0; dx < Math.max(1, f.w); dx++) for (let dy = 0; dy < Math.max(1, f.h); dy++) if (canSee(f.x + dx, f.y + dy)) return true;
    return false;
  };
}
