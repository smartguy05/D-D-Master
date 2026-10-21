import { cellKey, cellsInRadius } from "./fog.js";
import type { RollResult, WallSeg } from "./schemas.js";

/**
 * Line of sight, cover and wall movement on the map grid (pure; shared by the server engine and
 * the web). Cell (x, y) is the square [x, x+1] x [y, y+1]; wall segments run along cell edges
 * between grid-line intersections.
 *
 * Sight follows the SRD corner-to-corner rule: pick a corner of the attacker's square and trace
 * lines to every corner of the target's square. Corners are pulled a little toward the cell centre
 * so two cells side by side across a wall don't "see" each other through their shared corner, and
 * a line that touches a segment's end counts as blocked (no peeking through wall junctions).
 */

type Cell = { x: number; y: number };
type Seg = Pick<WallSeg, "x1" | "y1" | "x2" | "y2" | "kind" | "open">;
export type Cover = "none" | "half" | "three-quarters" | "total";

/** How far corners are pulled toward the cell centre, in cells. */
const INSET = 1e-3;
/** Float tolerance for "touches" tests. */
const TOL = 1e-9;

export function blocksSight(w: Pick<Seg, "kind" | "open">): boolean {
  return !(w.kind === "window") && !(w.kind === "door" && w.open);
}

export function blocksMove(w: Pick<Seg, "kind" | "open">): boolean {
  return w.kind === "window" || w.kind === "wall" || (w.kind === "door" && !w.open);
}

const blocksFor = (mode: "sight" | "move") => (mode === "sight" ? blocksSight : blocksMove);

/** True iff a and b are orthogonal neighbours and a segment blocking for `mode` covers their whole shared edge. */
export function edgeBlocked(a: Cell, b: Cell, walls: readonly Seg[], mode: "sight" | "move"): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  const blocks = blocksFor(mode);
  if (dx !== 0) {
    const ex = Math.max(a.x, b.x);
    return walls.some((w) => blocks(w) && w.x1 === ex && w.x2 === ex && Math.min(w.y1, w.y2) <= a.y && Math.max(w.y1, w.y2) >= a.y + 1);
  }
  const ey = Math.max(a.y, b.y);
  return walls.some((w) => blocks(w) && w.y1 === ey && w.y2 === ey && Math.min(w.x1, w.x2) <= a.x && Math.max(w.x1, w.x2) >= a.x + 1);
}

/** Does the segment p→q touch the axis-aligned wall segment w (endpoints inclusive)? */
function crosses(px: number, py: number, qx: number, qy: number, w: Seg): boolean {
  if (w.x1 === w.x2) return crossesLine(px, py, qx, qy, w.x1, Math.min(w.y1, w.y2), Math.max(w.y1, w.y2));
  // Horizontal: swap the axes.
  return crossesLine(py, px, qy, qx, w.y1, Math.min(w.x1, w.x2), Math.max(w.x1, w.x2));
}

/** Segment p→q against the vertical segment x = X, y in [lo, hi]. */
function crossesLine(px: number, py: number, qx: number, qy: number, X: number, lo: number, hi: number): boolean {
  if ((px < X - TOL && qx < X - TOL) || (px > X + TOL && qx > X + TOL)) return false;
  const ddx = qx - px;
  if (Math.abs(ddx) < TOL) {
    // Runs along the line x = X: blocked where the spans overlap.
    return Math.max(Math.min(py, qy), lo) <= Math.min(Math.max(py, qy), hi) + TOL;
  }
  const t = Math.min(1, Math.max(0, (X - px) / ddx));
  const y = py + t * (qy - py);
  return y >= lo - TOL && y <= hi + TOL;
}

function corners(c: Cell): Array<[number, number]> {
  const a = c.x + INSET;
  const b = c.x + 1 - INSET;
  const d = c.y + INSET;
  const e = c.y + 1 - INSET;
  return [
    [a, d],
    [b, d],
    [a, e],
    [b, e],
  ];
}

const sightWalls = (walls: readonly Seg[]) => walls.filter(blocksSight);

function lineBlocked(p: [number, number], q: [number, number], walls: readonly Seg[]): boolean {
  for (const w of walls) if (crosses(p[0], p[1], q[0], q[1], w)) return true;
  return false;
}

/** SRD line of sight: some line from a corner of `from` to a corner of `to` crosses no sight-blocking segment. */
export function hasLineOfSight(from: Cell, to: Cell, walls: readonly Seg[]): boolean {
  if (from.x === to.x && from.y === to.y) return true;
  const ws = sightWalls(walls);
  if (ws.length === 0) return true;
  const tc = corners(to);
  for (const p of corners(from)) for (const q of tc) if (!lineBlocked(p, q, ws)) return true;
  return false;
}

/** Does the segment p→q pass through the interior of cell b? (Liang–Barsky clip against the open square.) */
function crossesCell(p: [number, number], q: [number, number], b: Cell): boolean {
  const lo = [b.x + TOL, b.y + TOL];
  const hi = [b.x + 1 - TOL, b.y + 1 - TOL];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 2; i++) {
    const s = p[i]!;
    const d = q[i]! - s;
    if (Math.abs(d) < 1e-15) {
      if (s <= lo[i]! || s >= hi[i]!) return false;
      continue;
    }
    let a = (lo[i]! - s) / d;
    let z = (hi[i]! - s) / d;
    if (a > z) [a, z] = [z, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, z);
    if (t0 >= t1) return false;
  }
  return true;
}

const COVER_RANK: Cover[] = ["none", "half", "three-quarters", "total"];
const coverFromBlocked = (n: number): Cover => (n === 0 ? "none" : n <= 2 ? "half" : n === 3 ? "three-quarters" : "total");

/**
 * SRD cover of `target` from `attacker`. For each attacker corner, count the lines to the target's
 * 4 corners blocked by sight-blocking segments (0 none, 1-2 half, 3 three-quarters, 4 total) and use
 * the corner best for the attacker. `blockers` (cells of other creatures and `blocks` features)
 * raise cover to at least half when a clear line from that corner passes through one, never more.
 */
export function coverBetween(attacker: Cell, target: Cell, walls: readonly Seg[], blockers: readonly Cell[] = []): Cover {
  if (attacker.x === target.x && attacker.y === target.y) return "none";
  const ws = sightWalls(walls);
  const bs = blockers.filter((b) => !(b.x === attacker.x && b.y === attacker.y) && !(b.x === target.x && b.y === target.y));
  const tc = corners(target);
  let best = COVER_RANK.length - 1;
  for (const p of corners(attacker)) {
    let blocked = 0;
    let throughBlocker = false;
    for (const q of tc) {
      if (lineBlocked(p, q, ws)) blocked++;
      else if (!throughBlocker && bs.some((b) => crossesCell(p, q, b))) throughBlocker = true;
    }
    let rank = COVER_RANK.indexOf(coverFromBlocked(blocked));
    if (rank === 0 && throughBlocker) rank = 1;
    best = Math.min(best, rank);
    if (best === 0) break;
  }
  return COVER_RANK[best]!;
}

/** Cells within `radius` of (cx, cy) that the origin cell has line of sight to ("x,y" keys). */
export function visibleCells(cx: number, cy: number, radius: number, gridW: number, gridH: number, walls: readonly Seg[]): string[] {
  const inRadius = cellsInRadius(cx, cy, radius, gridW, gridH);
  const ws = sightWalls(walls);
  const origin = cellKey(cx, cy);
  if (ws.length === 0) return inRadius;
  const out = inRadius.filter((k) => {
    if (k === origin) return true;
    const [x, y] = k.split(",").map(Number);
    return hasLineOfSight({ x: cx, y: cy }, { x: x!, y: y! }, ws);
  });
  // The origin is always visible (a token standing just off the grid edge still sees its own cell).
  if (!out.includes(origin) && cx >= 0 && cy >= 0 && cx < gridW && cy < gridH) out.push(origin);
  return out;
}

/** Does the straight line between the two cell centres cross (inclusive) a wall, closed door or window? */
export function moveBlocked(from: Cell, to: Cell, walls: readonly Seg[]): boolean {
  if (from.x === to.x && from.y === to.y) return false;
  const px = from.x + 0.5;
  const py = from.y + 0.5;
  const qx = to.x + 0.5;
  const qy = to.y + 0.5;
  return walls.some((w) => blocksMove(w) && crosses(px, py, qx, qy, w));
}

const COVER_LABEL = { half: "half cover +2", "three-quarters": "three-quarters cover +5" } as const;

/**
 * Roll breakdown suffix for an attack at a target in cover, e.g. " vs AC 15 (half cover +2)"
 * (the dc already includes the bonus); "" without cover or for a secret roll.
 */
export function coverNote(roll: Pick<RollResult, "cover" | "dc" | "secret">): string {
  if (!roll.cover || roll.secret) return "";
  return roll.dc !== undefined ? ` vs AC ${roll.dc} (${COVER_LABEL[roll.cover]})` : ` (${COVER_LABEL[roll.cover]})`;
}

export interface WalkGrid {
  gridW: number;
  gridH: number;
  walls: readonly Seg[];
  /** Cells nobody can walk into ("x,y" keys): furniture from `blocks` features. The start and goal cells are exempt. */
  blocked?: ReadonlySet<string>;
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Breadth-first walk from `from` over the grid: 8 neighbours, every step one square (5 ft, SRD
 * diagonals), no step across a wall, closed door or window (a diagonal past a wall's end counts as
 * crossing it). Returns squares walked per reachable "x,y" key, and each cell's predecessor.
 */
function walk(from: Cell, g: WalkGrid, goal?: Cell) {
  const dist = new Map<string, number>([[cellKey(from.x, from.y), 0]]);
  const prev = new Map<string, Cell>();
  const goalKey = goal && cellKey(goal.x, goal.y);
  const walls = g.walls.filter(blocksMove);
  const queue: Cell[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i]!;
    const d = dist.get(cellKey(a.x, a.y))!;
    for (const [dx, dy] of STEPS) {
      const b = { x: a.x + dx, y: a.y + dy };
      const k = cellKey(b.x, b.y);
      if (b.x < 0 || b.y < 0 || b.x >= g.gridW || b.y >= g.gridH || dist.has(k)) continue;
      if (k !== goalKey && g.blocked?.has(k)) continue;
      if (moveBlocked(a, b, walls)) continue;
      dist.set(k, d + 1);
      prev.set(k, a);
      if (k === goalKey) return { dist, prev };
      queue.push(b);
    }
  }
  return { dist, prev };
}

/** Squares walked to every cell reachable from `from` ("x,y" key → squares). */
export function reachableCells(from: Cell, g: WalkGrid): Map<string, number> {
  return walk(from, g).dist;
}

/**
 * Shortest walk from `from` to `to` around walls, closed doors, windows and blocked cells, as the
 * cells after `from` (the last is `to`) and its length in squares; null when no route exists.
 */
export function findPath(from: Cell, to: Cell, g: WalkGrid): { path: Cell[]; squares: number } | null {
  if (from.x === to.x && from.y === to.y) return { path: [], squares: 0 };
  const { dist, prev } = walk(from, g, to);
  const squares = dist.get(cellKey(to.x, to.y));
  if (squares === undefined) return null;
  const path: Cell[] = [];
  for (let c: Cell | undefined = to; c && !(c.x === from.x && c.y === from.y); c = prev.get(cellKey(c.x, c.y))) path.unshift(c);
  return { path, squares };
}
