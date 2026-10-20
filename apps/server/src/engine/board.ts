import { cellKey, effectiveFeatures, effectiveWalls, MapFeature, type GameState, type Location, type ToolArgsOf, type WallSeg } from "@dm/shared";
import { fogEntry, hideCells, revealAroundCharacters, revealCells } from "./fog.js";
import { requireCombatant } from "./state.js";

/**
 * Host board tools: fog painting, map-feature and wall fixes, and monster visibility. Handlers
 * mutate the cloned state they are given (see executeEngineTool) and never touch the campaign
 * outline: feature fixes live in `state.featureEdits` (reset when the map is repainted) and wall
 * fixes in `state.wallEdits` (kept until the host resets them), so both are undoable.
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
    const at = features[a.index]!.name;
    if (a.expect_name !== undefined && at !== a.expect_name)
      throw new Error(`Feature ${a.index} is "${at}", not "${a.expect_name}"; the map changed, try again.`);
    return a.index;
  };
  let index: number;
  if (a.action === "add") {
    features.push(clampFeature(MapFeature.parse(sanitizeBox(a.feature ?? {})), loc.gridW, loc.gridH));
    index = features.length - 1;
  } else if (a.action === "update") {
    index = needIndex();
    features[index] = clampFeature(MapFeature.parse(sanitizeBox({ ...features[index], ...stripUndefined(a.feature ?? {}) })), loc.gridW, loc.gridH);
  } else {
    index = needIndex();
    features.splice(index, 1);
  }
  state.featureEdits[loc.id] = { mapUrl: loc.mapUrl ?? "", features };
  return { action: a.action, index, feature: a.action === "delete" ? undefined : features[index], count: features.length };
}

const WALL_PREFIX: Record<WallSeg["kind"], string> = { wall: "w", door: "d", window: "win" };

/** A fresh id for a new segment: the kind's prefix and the next unused number. */
function freshWallId(walls: WallSeg[], kind: WallSeg["kind"]): string {
  const ids = new Set(walls.map((w) => w.id));
  let n = walls.filter((w) => w.kind === kind).length + 1;
  while (ids.has(`${WALL_PREFIX[kind]}${n}`)) n++;
  return `${WALL_PREFIX[kind]}${n}`;
}

/**
 * Cut the stretch under a new door or window out of the walls on the same grid line (a door also
 * cuts windows), like `wallsFromLines` does for the map read: otherwise the wall underneath keeps
 * blocking sight and movement through the open door. A cut wall keeps its id for its first piece.
 */
function cutUnder(walls: WallSeg[], seg: WallSeg): WallSeg[] {
  const cuts = seg.kind === "door" ? ["wall", "window"] : seg.kind === "window" ? ["wall"] : [];
  const vertical = seg.x1 === seg.x2;
  const span = (w: WallSeg) => (vertical ? [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)]) as [number, number];
  const [lo, hi] = span(seg);
  const out: WallSeg[] = [];
  for (const w of walls) {
    const sameLine = vertical ? w.x1 === w.x2 && w.x1 === seg.x1 : w.y1 === w.y2 && w.y1 === seg.y1;
    const [a, b] = span(w);
    if (!cuts.includes(w.kind) || !sameLine || b <= lo || a >= hi) {
      out.push(w);
      continue;
    }
    const pieces = ([[a, Math.min(b, lo)], [Math.max(a, hi), b]] as [number, number][]).filter(([p, q]) => q > p);
    pieces.forEach(([p, q], i) => {
      const id = i === 0 ? w.id : freshWallId([...walls, ...out, seg], w.kind);
      out.push(vertical ? { ...w, id, y1: p, y2: q } : { ...w, id, x1: p, x2: q });
    });
  }
  return out;
}

/**
 * Host wall editor: add a wall/door/window segment, delete one, open/close a door (toggle), or
 * reset to the walls read from the map. Every change writes `state.wallEdits[location]`; with fog
 * on, the party's view is recomputed (an opened door or a deleted wall shows what is behind it).
 */
export function editWalls(state: GameState, a: ToolArgsOf<"edit_walls">, ctx: BoardCtx) {
  const loc = currentLocation(state, ctx);
  state.wallEdits ??= {};
  if (a.action === "reset") {
    delete state.wallEdits[loc.id];
    return { action: "reset", walls: (loc.walls ?? []).length };
  }
  const walls = structuredClone(effectiveWalls(state, loc));
  const find = () => {
    const i = a.id === undefined ? -1 : walls.findIndex((w) => w.id === a.id);
    if (i < 0) throw new Error(`No wall segment "${a.id ?? "(none)"}". Ids: ${walls.map((w) => w.id).join(", ") || "none"}.`);
    return i;
  };
  let seg: WallSeg | undefined;
  if (a.action === "add") {
    if (!a.segment) throw new Error("add needs a segment {x1, y1, x2, y2, kind}.");
    const r = (v: number) => Math.round(v);
    let [x1, y1, x2, y2] = [r(a.segment.x1), r(a.segment.y1), r(a.segment.x2), r(a.segment.y2)];
    if (x1 !== x2 && y1 !== y2) throw new Error("A wall segment must run along one grid row or column (not diagonal).");
    if (x1 === x2 && y1 === y2) throw new Error("A wall segment needs two different grid points.");
    // The line it runs along must be on the board; only its length is clamped to the grid.
    const outside = x1 === x2 ? x1 < 0 || x1 > loc.gridW : y1 < 0 || y1 > loc.gridH;
    if (outside) throw new Error(`That segment lies outside the ${loc.gridW}x${loc.gridH} grid.`);
    const cx = (v: number) => Math.max(0, Math.min(loc.gridW, v));
    const cy = (v: number) => Math.max(0, Math.min(loc.gridH, v));
    [x1, y1, x2, y2] = [cx(x1), cy(y1), cx(x2), cy(y2)];
    if (x1 === x2 && y1 === y2) throw new Error(`That segment lies outside the ${loc.gridW}x${loc.gridH} grid.`);
    seg = { id: freshWallId(walls, a.segment.kind), x1, y1, x2, y2, kind: a.segment.kind, open: false };
    const kept = cutUnder(walls, seg);
    walls.splice(0, walls.length, ...kept, seg);
  } else if (a.action === "delete") {
    seg = walls.splice(find(), 1)[0];
  } else {
    seg = walls[find()]!;
    if (seg.kind !== "door") throw new Error(`${seg.id} is a ${seg.kind}; only doors open and close.`);
    seg.open = !seg.open;
  }
  state.wallEdits[loc.id] = { walls, host: true };
  const revealed = revealAroundCharacters(state, { gridW: loc.gridW, gridH: loc.gridH, features: effectiveFeatures(state, loc), walls });
  return { action: a.action, segment: seg, count: walls.length, revealed };
}

export function setMonsterHidden(state: GameState, a: ToolArgsOf<"set_monster_hidden">) {
  const c = requireCombatant(state, a.monster_id);
  if (c.kind !== "monster") throw new Error(`${c.entity.name} is not a monster.`);
  c.entity.hidden = a.hidden;
  return { name: c.entity.name, hidden: a.hidden };
}

/** Round box numbers and lift them to their minimums (x/y ≥ 0, w/h ≥ 1) so validation does not reject them. */
function sanitizeBox<T extends { x?: number; y?: number; w?: number; h?: number }>(f: T): T {
  const out = { ...f };
  for (const k of ["x", "y", "w", "h"] as const) {
    const v = out[k];
    if (typeof v === "number") out[k] = Number.isFinite(v) ? Math.max(k === "w" || k === "h" ? 1 : 0, Math.round(v)) : undefined;
  }
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
