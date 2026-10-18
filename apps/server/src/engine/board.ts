import { cellKey, effectiveFeatures, MapFeature, type GameState, type Location, type ToolArgsOf } from "@dm/shared";
import { fogEntry, hideCells, revealCells } from "./fog.js";
import { requireCombatant } from "./state.js";

/**
 * Host board tools: fog painting, map-feature fixes and monster visibility. Handlers mutate the
 * cloned state they are given (see executeEngineTool) and never touch the campaign outline: feature
 * fixes live in `state.featureEdits` so they are undoable and reset when the map is repainted.
 */

interface BoardCtx {
  locations: Location[];
}

function currentLocation(state: GameState, ctx: BoardCtx): Location {
  const loc = state.locationId ? ctx.locations.find((l) => l.id === state.locationId) : undefined;
  if (!loc) throw new Error("No current location.");
  return loc;
}

/** Keep a feature box inside the grid (at least one cell). */
export function clampFeature(f: MapFeature, gridW: number, gridH: number): MapFeature {
  const x = Math.max(0, Math.min(gridW - 1, f.x));
  const y = Math.max(0, Math.min(gridH - 1, f.y));
  return { ...f, x, y, w: Math.max(1, Math.min(gridW - x, f.w)), h: Math.max(1, Math.min(gridH - y, f.h)) };
}

export function editFog(state: GameState, a: ToolArgsOf<"edit_fog">, ctx: BoardCtx) {
  const loc = currentLocation(state, ctx);
  const cells = a.cells.filter(([x, y]) => x >= 0 && y >= 0 && x < loc.gridW && y < loc.gridH).map(([x, y]) => cellKey(x, y));
  const changed = a.mode === "reveal" ? revealCells(state, cells, { explicit: true }) : hideCells(state, cells);
  const fog = fogEntry(state)!;
  return { mode: a.mode, cells: cells.length, changed, fogEnabled: fog.enabled, hidden: fog.hidden.length };
}

export function editMapFeature(state: GameState, a: ToolArgsOf<"edit_map_feature">, ctx: BoardCtx) {
  const loc = currentLocation(state, ctx);
  state.featureEdits ??= {};
  if (a.action === "reset") {
    delete state.featureEdits[loc.id];
    return { action: "reset", features: loc.features.length };
  }
  const features = structuredClone(effectiveFeatures(state, loc));
  const needIndex = () => {
    if (a.index === undefined || a.index >= features.length) throw new Error(`Bad feature index ${a.index ?? "(none)"}; there are ${features.length}.`);
    return a.index;
  };
  let index: number;
  if (a.action === "add") {
    features.push(clampFeature(MapFeature.parse(a.feature ?? {}), loc.gridW, loc.gridH));
    index = features.length - 1;
  } else if (a.action === "update") {
    index = needIndex();
    features[index] = clampFeature(MapFeature.parse({ ...features[index], ...stripUndefined(a.feature ?? {}) }), loc.gridW, loc.gridH);
  } else {
    index = needIndex();
    features.splice(index, 1);
  }
  state.featureEdits[loc.id] = { mapUrl: loc.mapUrl ?? "", features };
  return { action: a.action, index, feature: a.action === "delete" ? undefined : features[index], count: features.length };
}

export function setMonsterHidden(state: GameState, a: ToolArgsOf<"set_monster_hidden">) {
  const c = requireCombatant(state, a.monster_id);
  if (c.kind !== "monster") throw new Error(`${c.entity.name} is not a monster.`);
  c.entity.hidden = a.hidden;
  return { name: c.entity.name, hidden: a.hidden };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
