import { cellsInRect } from "./fog.js";
import { hasLineOfSight } from "./los.js";
import type { FeatureEdit, Location, MapFeature, WallSeg } from "./schemas.js";

/**
 * Map features: landmarks read off a painted map image, in grid cells. The map texture is
 * stretched exactly over the grid, so a fraction of the image is the same fraction of the board.
 */

/** How far (in cells) a lit feature's glow reaches through fog. */
export const LIT_FEATURE_RADIUS = 2;

/** A feature as the vision model reports it: a box in image fractions [x0, y0, x1, y1] (0..1). */
export interface FeatureBox {
  name: string;
  kind: MapFeature["kind"];
  lit: boolean;
  blocks?: boolean;
  /** Something players can use or open (lever, chest, altar, door). */
  interactive?: boolean;
  box: [number, number, number, number];
}

type Grid = Pick<Location, "gridW" | "gridH" | "features">;

/** A wall, door or window as the vision model reports it: a polyline in image fractions (0..1). */
export interface WallLine {
  kind: WallSeg["kind"];
  points: [number, number][];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function featureFromBox(b: FeatureBox, gridW: number, gridH: number): MapFeature {
  const [ax, ay, bx, by] = b.box;
  const x0 = clamp(Math.floor(Math.min(ax, bx) * gridW), 0, gridW - 1);
  const y0 = clamp(Math.floor(Math.min(ay, by) * gridH), 0, gridH - 1);
  const x1 = clamp(Math.ceil(Math.max(ax, bx) * gridW) - 1, x0, gridW - 1);
  const y1 = clamp(Math.ceil(Math.max(ay, by) * gridH) - 1, y0, gridH - 1);
  return { name: b.name, kind: b.kind, lit: b.lit, blocks: b.blocks ?? false, interactive: b.interactive ?? false, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The features to use for a location: the host's edit (state.featureEdits) while it was made for
 * the location's current map picture, else the features read from the map. Repainting the map
 * changes `mapUrl`, so old edits stop applying on their own.
 */
export function effectiveFeatures(
  state: { featureEdits?: Record<string, Pick<FeatureEdit, "features"> & { mapUrl?: string }> } | null | undefined,
  loc: Pick<Location, "id" | "features"> & { mapUrl?: string },
): MapFeature[] {
  const edit = state?.featureEdits?.[loc.id];
  if (edit && (edit.mapUrl ?? "") === (loc.mapUrl ?? "")) return edit.features;
  return loc.features ?? [];
}

/**
 * The walls to use for a location: the edit in state.wallEdits (host editor, set_door) when there
 * is one, else the walls read from the map. Unlike features there is no mapUrl gate, so host fixes
 * and door states survive a repaint of the same location until the host resets them.
 */
export function effectiveWalls(
  state: { wallEdits?: Record<string, { walls: WallSeg[] }> } | null | undefined,
  // mapUrl is accepted (a Location) but ignored: wall edits have no map-picture gate.
  loc: Pick<Location, "id"> & { walls?: WallSeg[]; mapUrl?: string },
): WallSeg[] {
  const edit = state?.wallEdits?.[loc.id];
  if (edit) return edit.walls;
  return loc.walls ?? [];
}

type Pt = [number, number];
type Edge = { x1: number; y1: number; x2: number; y2: number };

/** Split one snapped leg into axis-aligned unit-free legs: straight legs stay whole, diagonals become a staircase of unit edges. */
function legToEdges(a: Pt, b: Pt): Edge[] {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (ax === bx && ay === by) return [];
  if (ax === bx || ay === by) return [{ x1: ax, y1: ay, x2: bx, y2: by }];
  const sx = Math.sign(bx - ax);
  const sy = Math.sign(by - ay);
  const out: Edge[] = [];
  let x = ax;
  let y = ay;
  // Distance of a point from the ideal line a→b (unnormalised: only compared).
  const off = (px: number, py: number) => Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax));
  while (x !== bx || y !== by) {
    const canX = x !== bx;
    const canY = y !== by;
    const stepX = canX && (!canY || off(x + sx, y) <= off(x, y + sy));
    const nx = stepX ? x + sx : x;
    const ny = stepX ? y : y + sy;
    out.push({ x1: x, y1: y, x2: nx, y2: ny });
    x = nx;
    y = ny;
  }
  return out;
}

/** The unit grid edge under the midpoint of a door too short to snap (image fractions in, grid units out). */
function unitDoor(raw: Pt[], gridW: number, gridH: number): Edge {
  const xs = raw.map((p) => p[0] * gridW);
  const ys = raw.map((p) => p[1] * gridH);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const mx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const my = (Math.max(...ys) + Math.min(...ys)) / 2;
  if (spanX >= spanY) {
    const x = clamp(Math.floor(mx), 0, gridW - 1);
    const y = clamp(Math.round(my), 0, gridH);
    return { x1: x, y1: y, x2: x + 1, y2: y };
  }
  const x = clamp(Math.round(mx), 0, gridW);
  const y = clamp(Math.floor(my), 0, gridH - 1);
  return { x1: x, y1: y, x2: x, y2: y + 1 };
}

/** Unit edges of an axis-aligned edge, as "x,y,h|v" keys (the edge starting at x,y going right or down). */
function unitKeys(e: Edge): string[] {
  const out: string[] = [];
  if (e.y1 === e.y2) for (let x = Math.min(e.x1, e.x2); x < Math.max(e.x1, e.x2); x++) out.push(`${x},${e.y1},h`);
  else for (let y = Math.min(e.y1, e.y2); y < Math.max(e.y1, e.y2); y++) out.push(`${e.x1},${y},v`);
  return out;
}

/** Merge unit edges into maximal straight runs, in a stable order (horizontal rows, then vertical columns). */
function mergeUnits(keys: Iterable<string>): Edge[] {
  const set = new Set(keys);
  const units = [...set].map((k) => {
    const [x, y, d] = k.split(",");
    return { x: Number(x), y: Number(y), h: d === "h" };
  });
  units.sort((a, b) => Number(b.h) - Number(a.h) || (a.h ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y));
  const out: Edge[] = [];
  const used = new Set<string>();
  for (const u of units) {
    const k = `${u.x},${u.y},${u.h ? "h" : "v"}`;
    if (used.has(k)) continue;
    let len = 0;
    while (set.has(u.h ? `${u.x + len},${u.y},h` : `${u.x},${u.y + len},v`)) {
      used.add(u.h ? `${u.x + len},${u.y},h` : `${u.x},${u.y + len},v`);
      len++;
    }
    out.push(u.h ? { x1: u.x, y1: u.y, x2: u.x + len, y2: u.y } : { x1: u.x, y1: u.y, x2: u.x, y2: u.y + len });
  }
  return out;
}

/**
 * Turn the vision model's wall/door/window polylines (image fractions) into grid segments. Points
 * snap to the nearest grid intersection (clamped to the grid); each leg becomes axis-aligned
 * segments (a diagonal leg a staircase of unit edges); zero-length legs are dropped. Walls and
 * windows are merged into maximal straight runs (duplicates removed), and a wall never covers a
 * door or window edge. Each door line stays its own door (one segment, or unit segments if it was
 * diagonal), closed. Ids are deterministic: w1.. for walls, d1.. for doors, win1.. for windows.
 */
export function wallsFromLines(lines: WallLine[], gridW: number, gridH: number): WallSeg[] {
  const snap = ([fx, fy]: Pt): Pt => [clamp(Math.round(fx * gridW), 0, gridW), clamp(Math.round(fy * gridH), 0, gridH)];
  const units = { wall: new Set<string>(), window: new Set<string>() };
  const doors: Edge[] = [];
  const doorUnits = new Set<string>();
  for (const line of lines) {
    const raw = line.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const pts = raw.map(snap);
    const edges: Edge[] = [];
    for (let i = 1; i < pts.length; i++) edges.push(...legToEdges(pts[i - 1]!, pts[i]!));
    const kind = line.kind;
    // A doorway narrower than a cell snaps to one point: keep it as the one unit edge under its
    // midpoint (along its longer direction) instead of dropping it, or the walls on either side
    // meet and seal the doorway.
    if (kind === "door" && edges.length === 0 && raw.length >= 2) edges.push(unitDoor(raw, gridW, gridH));
    if (kind === "door") {
      for (const e of edges) {
        const ks = unitKeys(e);
        if (ks.every((k) => doorUnits.has(k))) continue; // duplicate door
        ks.forEach((k) => doorUnits.add(k));
        doors.push(e);
      }
    } else {
      for (const e of edges) unitKeys(e).forEach((k) => units[kind].add(k));
    }
  }
  for (const k of doorUnits) {
    units.wall.delete(k);
    units.window.delete(k);
  }
  for (const k of units.window) units.wall.delete(k);
  const out: WallSeg[] = [];
  mergeUnits(units.wall).forEach((e, i) => out.push({ id: `w${i + 1}`, ...e, kind: "wall", open: false }));
  doors.forEach((e, i) => out.push({ id: `d${i + 1}`, ...e, kind: "door", open: false }));
  mergeUnits(units.window).forEach((e, i) => out.push({ id: `win${i + 1}`, ...e, kind: "window", open: false }));
  return out;
}

export function featureCenter(f: MapFeature): { x: number; y: number } {
  return { x: f.x + Math.floor((f.w - 1) / 2), y: f.y + Math.floor((f.h - 1) / 2) };
}

/** Where the party arrives: the entrance, stepped one cell in from the board edge (default: left edge, middle row). */
export function entryCell(loc: Grid): { x: number; y: number } {
  const door = loc.features.find((f) => f.kind === "entrance");
  if (!door) return { x: 1, y: Math.floor(loc.gridH / 2) };
  const c = featureCenter(door);
  return { x: clamp(c.x, 1, loc.gridW - 2), y: clamp(c.y, 1, loc.gridH - 2) };
}

/** Default monster spawn: the focal feature (default: toward the right edge, middle row). */
export function spawnCell(loc: Grid): { x: number; y: number } {
  const focal = loc.features.find((f) => f.kind === "focal");
  return focal ? featureCenter(focal) : { x: loc.gridW - 3, y: Math.floor(loc.gridH / 2) };
}

/**
 * Cells lit by `lit` features (their box grown by LIT_FEATURE_RADIUS), clipped to the grid. With
 * walls (`walls`, else `loc.walls`) a cell is lit only when some cell of the feature has line of
 * sight to it, so the glow does not cross a closed wall or door.
 */
export function litFeatureCells(loc: Grid & { walls?: readonly WallSeg[] }, walls: readonly WallSeg[] = loc.walls ?? []): string[] {
  const r = LIT_FEATURE_RADIUS;
  return loc.features
    .filter((f) => f.lit)
    .flatMap((f) => {
      const box = cellsInRect(f.x - r, f.y - r, f.w + 2 * r, f.h + 2 * r, loc.gridW, loc.gridH);
      if (walls.length === 0) return box;
      const own = cellsInRect(f.x, f.y, f.w, f.h, loc.gridW, loc.gridH).map((k) => k.split(",").map(Number) as [number, number]);
      return box.filter((k) => {
        const [x, y] = k.split(",").map(Number);
        return own.some(([fx, fy]) => hasLineOfSight({ x: fx, y: fy }, { x: x!, y: y! }, walls));
      });
    });
}

/** One line per feature for the DM's instructions, e.g. "- altar (focal, lit): x 11-15, y 1-5". */
export function describeFeatures(features: MapFeature[]): string {
  const span = (a: number, n: number) => (n > 1 ? `${a}-${a + n - 1}` : `${a}`);
  return features
    .map((f) => {
      const tags = [f.kind !== "feature" ? f.kind : "", f.lit ? "lit" : "", f.blocks ? "blocks" : "", f.interactive ? "interactive" : ""].filter(Boolean).join(", ");
      return `- ${f.name}${tags ? ` (${tags})` : ""}: x ${span(f.x, f.w)}, y ${span(f.y, f.h)}`;
    })
    .join("\n");
}
