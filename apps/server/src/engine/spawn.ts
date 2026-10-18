import { cellKey, featureCenter, spawnCell, visibilityOf, type GameState, type MapFeature } from "@dm/shared";
import { blockedCells } from "./state.js";

/**
 * Spawn layout: where a group of new monsters goes on the grid. Pure and deterministic (no rng):
 * every legal cell gets a sort key and the best `count` cells win.
 *
 * Key, compared in order:
 * 1. hard: 0 free, 1 free but covered by a `blocks` feature, 2 already has a token. Blocked and
 *    occupied cells are only used when nothing else is left (a full or fully blocked board).
 * 2. too close: 1 if the cell is within 2 cells (Chebyshev) of a PC token. Skipped when the
 *    caller gave an exact x and y (the DM chose the spot).
 * 3. fog miss: 1 if the cell does not match the fog preference.
 * 4. the formation's own cost (cluster, arc or line), then row and column so ties are stable.
 */

export type SpawnFormation = "cluster" | "arc" | "line";
export type SpawnFog = "any" | "revealed" | "hidden";

export interface SpawnGrid {
  gridW: number;
  gridH: number;
  features: MapFeature[];
}

export interface SpawnOptions {
  /** Explicit grid cell (either part may be given); overrides the `near` / focal anchor. */
  anchor?: { x?: number; y?: number };
  /** Feature name (case-insensitive: exact, then prefix, then contains). */
  near?: string;
  formation?: SpawnFormation;
  fog?: SpawnFog;
}

/** Keep at least this many cells (Chebyshev) between a new monster and the nearest PC. */
export const MIN_PC_DISTANCE = 3;

/** Find a map feature by name: exact, then prefix, then contains (case-insensitive). Throws with the known names. */
export function findFeature(features: MapFeature[], name: string): MapFeature {
  const key = name.trim().toLowerCase();
  const lower = (f: MapFeature) => f.name.toLowerCase();
  const hit =
    features.find((f) => lower(f) === key) ??
    features.find((f) => lower(f).startsWith(key)) ??
    features.find((f) => lower(f).includes(key));
  if (key && hit) return hit;
  const known = features.map((f) => f.name);
  throw new Error(
    known.length
      ? `No map feature matches "${name}". Features here: ${known.join(", ")}.`
      : `No map feature matches "${name}": this map has no features. Use x and y instead.`,
  );
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Euclidean distance from a cell to the nearest cell of a rectangle (0 inside it). */
function distToRect(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return 0;
  const cos = (ax * bx + ay * by) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/**
 * Plan cells for `count` new monsters. Returns exactly `count` cells (it never throws for lack of
 * room: on a full board it reuses blocked, then occupied cells). The state is not modified.
 */
export function planSpawn(state: GameState, grid: SpawnGrid, count: number, opts: SpawnOptions = {}): { x: number; y: number }[] {
  const { gridW, gridH, features } = grid;
  const clampX = (v: number) => Math.max(0, Math.min(gridW - 1, Math.round(v)));
  const clampY = (v: number) => Math.max(0, Math.min(gridH - 1, Math.round(v)));
  const formation = opts.formation ?? "cluster";
  const fogPref = opts.fog ?? "any";

  // Anchor: explicit x/y > the `near` feature > the focal feature (lair, altar) > spawnCell's
  // right-middle default. A feature anchor is its whole footprint, so monsters gather around an
  // altar instead of trying its middle cell.
  const feature = opts.near ? findFeature(features, opts.near) : features.find((f) => f.kind === "focal");
  const explicit = opts.anchor?.x !== undefined || opts.anchor?.y !== undefined;
  const exactSpot = opts.anchor?.x !== undefined && opts.anchor?.y !== undefined;
  const point = (p: { x: number; y: number }): Rect => ({ x0: clampX(p.x), y0: clampY(p.y), x1: clampX(p.x), y1: clampY(p.y) });
  let rect: Rect;
  if (explicit) {
    const base = feature ? featureCenter(feature) : spawnCell(grid);
    rect = point({ x: opts.anchor?.x ?? base.x, y: opts.anchor?.y ?? base.y });
  } else if (feature) {
    rect = { x0: clampX(feature.x), y0: clampY(feature.y), x1: clampX(feature.x + feature.w - 1), y1: clampY(feature.y + feature.h - 1) };
  } else {
    rect = point(spawnCell(grid));
  }
  // Exact centre of the footprint (featureCenter rounds down, which skews angles for even sizes).
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;

  const blocked = blockedCells(features, gridW, gridH);
  const occupied = new Set(state.tokens.filter((t) => t.x >= 0 && t.y >= 0).map((t) => cellKey(t.x, t.y)));
  const pcs = state.tokens.filter((t) => t.entityType === "character" && t.x >= 0 && t.y >= 0);
  const visible = visibilityOf(state);

  // Facing: toward the party's centroid; without a party (or a party on the anchor), to the left
  // (the default entrance side).
  let fx = -1;
  let fy = 0;
  if (pcs.length) {
    const px = pcs.reduce((s, t) => s + t.x, 0) / pcs.length - cx;
    const py = pcs.reduce((s, t) => s + t.y, 0) / pcs.length - cy;
    const len = Math.hypot(px, py);
    if (len > 0) {
      fx = px / len;
      fy = py / len;
    }
  }
  // Arc radius (from the footprint's edge): roomy enough that the arc holds the group.
  const arcR = Math.max(2, Math.ceil(count / 2));
  // Line: perpendicular to the facing, through the first cell in front of the footprint.
  const halfAlong = Math.abs(fx) * (rect.x1 - rect.x0) / 2 + Math.abs(fy) * (rect.y1 - rect.y0) / 2;
  const lineOffset = rect.x0 === rect.x1 && rect.y0 === rect.y1 ? 0 : halfAlong + 1;

  const formationCost = (x: number, y: number): number => {
    const dx = x - cx;
    const dy = y - cy;
    if (formation === "arc") {
      const r = distToRect(x, y, rect);
      return Math.abs(r - arcR) * 3 + angleBetween(dx, dy, fx, fy) * arcR;
    }
    if (formation === "line") {
      const across = dx * fx + dy * fy - lineOffset;
      const along = -dx * fy + dy * fx;
      return Math.round(Math.abs(across)) * 100 + Math.abs(along);
    }
    // cluster: closest to the footprint, leaning to the side facing the party, then closest to its centre
    // (on a walkable feature such as a rug, its middle comes first).
    const d = distToRect(x, y, rect);
    return d * 10 + (d > 0 ? angleBetween(dx, dy, fx, fy) * 0.5 : 0) + Math.hypot(dx, dy) * 0.1;
  };

  const tooClose = (x: number, y: number) =>
    !exactSpot && pcs.some((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) < MIN_PC_DISTANCE);
  const fogMiss = (x: number, y: number) => (fogPref === "any" ? false : fogPref === "revealed" ? !visible(x, y) : visible(x, y));

  const cells: { x: number; y: number; key: number[] }[] = [];
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const k = cellKey(x, y);
      const hard = occupied.has(k) ? 2 : blocked.has(k) ? 1 : 0;
      cells.push({ x, y, key: [hard, tooClose(x, y) ? 1 : 0, fogMiss(x, y) ? 1 : 0, formationCost(x, y), y, x] });
    }
  }
  cells.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return 0;
  });
  // More monsters than cells (tiny, crowded board): wrap around and stack.
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const c = cells[i % cells.length];
    out.push({ x: c.x, y: c.y });
  }
  return out;
}
