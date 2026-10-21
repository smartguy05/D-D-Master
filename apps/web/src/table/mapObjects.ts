import type { GameState, MapFeature, Pickup } from "@dm/shared";
import { interactiveFeatureShownOnTable, mapObjectShownOnTable } from "./visibility";

/** Pure planning for the TV's loot markers, interactable auras and the pick-up toast. */

type View = Pick<GameState, "mapObjects" | "fog" | "locationId">;

export interface Aura {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LootMarker {
  id: string;
  x: number;
  y: number;
  iconUrl?: string;
}

/** Auras for the current location: shown interactables (1x1, hidden once used) and shown interactive features. */
export function auraPlan(state: View, features: MapFeature[]): Aura[] {
  const shownObj = mapObjectShownOnTable(state);
  const shownFeature = interactiveFeatureShownOnTable(state);
  const out: Aura[] = [];
  for (const o of state.mapObjects ?? []) {
    if (o.kind !== "interactable" || o.used || !shownObj(o)) continue;
    out.push({ key: `obj:${o.id}`, x: o.x, y: o.y, w: 1, h: 1 });
  }
  features.forEach((f, i) => {
    if (!shownFeature(f)) return;
    out.push({ key: `feat:${i}:${f.name}`, x: f.x, y: f.y, w: Math.max(1, f.w), h: Math.max(1, f.h) });
  });
  return out;
}

/** Loot objects the TV may show, with their sack icon when it has been drawn. */
export function lootMarkers(state: View): LootMarker[] {
  const shown = mapObjectShownOnTable(state);
  return (state.mapObjects ?? [])
    .filter((o) => o.kind === "loot" && shown(o))
    .map((o) => (o.iconUrl ? { id: o.id, x: o.x, y: o.y, iconUrl: o.iconUrl } : { id: o.id, x: o.x, y: o.y }));
}

/** "Sylvaine picks up Dagger x2, 15 gp". */
export function pickupToastText(p: Pickup): string {
  const parts = p.items.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name));
  if (p.gold > 0) parts.push(`${p.gold} gp`);
  return `${p.characterName} picks up ${parts.join(", ") || "nothing"}`;
}
