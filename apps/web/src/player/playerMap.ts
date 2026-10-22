import { activeFog, cellKey, doorVisible, effectiveFeatures, effectiveWalls, locationOfCharacter, revealedSet, sceneState, type GameState, type Location, type WallSeg } from "@dm/shared";
import { monsterShownOnTable } from "../table/visibility";
import { auraPlan, lootMarkers, type Aura, type LootMarker } from "../table/mapObjects";
import { monsterColor } from "../lib/tokenColor";

/**
 * The phone's map (party split): a top-down view of the player's own location, wherever their
 * group is, with what the table may see there (fog, hidden monsters, hidden objects). Pure planning
 * for PlayerMap.tsx.
 */

export interface MapToken {
  id: string;
  entityId: string;
  x: number;
  y: number;
  name: string;
  color: string;
  me: boolean;
  monster: boolean;
}

export interface ViewWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlayerMapPlan {
  locationId: string;
  gridW: number;
  gridH: number;
  mapUrl?: string;
  /** Unexplored cells to cover, or null when fog is off there. */
  fog: { x: number; y: number }[] | null;
  doors: WallSeg[];
  loot: LootMarker[];
  auras: Aura[];
  tokens: MapToken[];
  /** The player's own token cell, if it is on the board. */
  me?: { x: number; y: number };
}

/** The player's location and what to draw there; undefined before the first scene or for an unknown location. */
export function playerMapPlan(state: GameState, locations: readonly Location[], characterId: string): PlayerMapPlan | undefined {
  const locId = locationOfCharacter(state, characterId);
  const loc = locations.find((l) => l.id === locId);
  if (!loc) return undefined;
  const st = sceneState(state, loc.id);
  const f = activeFog(st);
  const seen = f ? revealedSet(f) : null;
  const fog = seen ? cellsOf(loc.gridW, loc.gridH).filter((c) => !seen.has(cellKey(c.x, c.y))) : null;
  const shown = monsterShownOnTable(st);
  const tokens: MapToken[] = st.tokens
    .filter((t) => t.x >= 0 && t.y >= 0 && shown(t.entityId))
    .map((t) => {
      const ch = st.characters.find((c) => c.id === t.entityId);
      const mon = st.monsters.find((m) => m.id === t.entityId);
      return {
        id: t.id,
        entityId: t.entityId,
        x: t.x,
        y: t.y,
        name: ch?.name ?? mon?.name ?? "?",
        color: ch?.color ?? (mon ? monsterColor(mon) : "#e0463c"),
        me: t.entityId === characterId,
        monster: !!mon,
      };
    });
  const mine = tokens.find((t) => t.me);
  return {
    locationId: loc.id,
    gridW: loc.gridW,
    gridH: loc.gridH,
    mapUrl: loc.mapUrl,
    fog,
    doors: effectiveWalls(st, loc).filter((w) => w.kind === "door" && doorVisible(w, seen)),
    loot: lootMarkers(st),
    auras: auraPlan(st, effectiveFeatures(st, loc)),
    tokens,
    me: mine ? { x: mine.x, y: mine.y } : undefined,
  };
}

function cellsOf(w: number, h: number) {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push({ x, y });
  return out;
}

/** The part of the grid to show: all of it, or (zoomed) a size×size window around the player's token, kept on the grid. */
export function viewWindow(plan: Pick<PlayerMapPlan, "gridW" | "gridH" | "me">, zoom: boolean, size = 12): ViewWindow {
  if (!zoom || !plan.me) return { x: 0, y: 0, w: plan.gridW, h: plan.gridH };
  const w = Math.min(size, plan.gridW);
  const h = Math.min(size, plan.gridH);
  const x = Math.max(0, Math.min(plan.gridW - w, plan.me.x - Math.floor(w / 2)));
  const y = Math.max(0, Math.min(plan.gridH - h, plan.me.y - Math.floor(h / 2)));
  return { x, y, w, h };
}
