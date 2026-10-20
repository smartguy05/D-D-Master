/**
 * Pure geometry for the host Board tab: pixels ↔ grid cells, drag rectangles and feature
 * move/resize. The SVG board uses one unit per grid cell (viewBox 0 0 gridW gridH).
 */

export interface Cell {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Corner = "nw" | "ne" | "sw" | "se";
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pointer position in fractional grid units (0..gridW, 0..gridH), not clamped. A zero-size board gives 0. */
export function clientToPoint(clientX: number, clientY: number, r: ClientRect, gridW: number, gridH: number): Cell {
  return { x: r.width > 0 ? ((clientX - r.left) / r.width) * gridW : 0, y: r.height > 0 ? ((clientY - r.top) / r.height) * gridH : 0 };
}

/** The grid cell under the pointer, clamped to the board. */
export function clientToCell(clientX: number, clientY: number, r: ClientRect, gridW: number, gridH: number): Cell {
  const p = clientToPoint(clientX, clientY, r, gridW, gridH);
  return { x: clamp(Math.floor(p.x), 0, gridW - 1), y: clamp(Math.floor(p.y), 0, gridH - 1) };
}

/** The cell rectangle spanned by two corner cells (inclusive), in either order. */
export function rectBetween(a: Cell, b: Cell): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

/** Every cell of a rectangle as [x, y], row by row (the edit_fog argument shape). */
export function cellsOfRect(r: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push([x, y]);
  return out;
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Shift a box by (dx, dy) cells, keeping it fully on the board (a box bigger than the board shrinks to fit). */
export function moveFeature(f: Rect, dx: number, dy: number, gridW: number, gridH: number): Rect {
  const w = clamp(f.w, 1, gridW);
  const h = clamp(f.h, 1, gridH);
  return { x: clamp(f.x + dx, 0, gridW - w), y: clamp(f.y + dy, 0, gridH - h), w, h };
}

/** Trim a box to the board: its top-left cell moves onto the board, then it is cut at the edges. */
export function trimToGrid(f: Rect, gridW: number, gridH: number): Rect {
  const x = clamp(f.x, 0, gridW - 1);
  const y = clamp(f.y, 0, gridH - 1);
  return { x, y, w: clamp(f.w, 1, gridW - x), h: clamp(f.h, 1, gridH - y) };
}

/**
 * Drag one corner of a box to `cell` (clamped to the board). The opposite corner stays put; the
 * box never flips past it and never shrinks below one cell.
 */
export function resizeFeature(f: Rect, corner: Corner, cell: Cell, gridW: number, gridH: number): Rect {
  const cx = clamp(cell.x, 0, gridW - 1);
  const cy = clamp(cell.y, 0, gridH - 1);
  f = trimToGrid(f, gridW, gridH);
  let x0 = f.x;
  let y0 = f.y;
  let x1 = f.x + f.w - 1;
  let y1 = f.y + f.h - 1;
  if (corner === "nw" || corner === "sw") x0 = Math.min(cx, x1);
  else x1 = Math.max(cx, x0);
  if (corner === "nw" || corner === "ne") y0 = Math.min(cy, y1);
  else y1 = Math.max(cy, y0);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The corner handle of box `f` within `tol` grid units of point `p`, if any. */
export function hitCorner(f: Rect, p: Cell, tol: number): Corner | null {
  const corners: [Corner, number, number][] = [
    ["nw", f.x, f.y],
    ["ne", f.x + f.w, f.y],
    ["sw", f.x, f.y + f.h],
    ["se", f.x + f.w, f.y + f.h],
  ];
  for (const [c, x, y] of corners) if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return c;
  return null;
}

/**
 * The feature panel's x/y/w/h text fields as a box: an empty or non-numeric field keeps the
 * feature's current value (never 0), numbers are rounded, and the result is trimmed to the board.
 */
export function boxFromInputs(raw: Record<"x" | "y" | "w" | "h", string>, current: Rect, gridW: number, gridH: number): Rect {
  const read = (k: "x" | "y" | "w" | "h") => {
    const t = raw[k].trim();
    const v = t === "" ? NaN : Number(t);
    return Number.isFinite(v) ? Math.round(v) : current[k];
  };
  return trimToGrid({ x: read("x"), y: read("y"), w: Math.max(1, read("w")), h: Math.max(1, read("h")) }, gridW, gridH);
}

/**
 * Generous width of a board label in grid cells (0.42-cell font): wide enough for capitals, so a
 * label rather flips to its right edge than runs off the board. Emoji are wider; joiners take none.
 */
export function labelWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue; // zero-width joiner, variation selectors
    w += cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) ? 0.45 : 0.3;
  }
  return w;
}

/**
 * Where a feature's label goes so it stays on the board: from the feature's left edge when it
 * fits, else ending at its right edge, else pushed in from the board edge.
 */
export function featureLabelPlacement(b: Rect, gridW: number, text: string): { x: number; anchor: "start" | "end" } {
  const pad = 0.15;
  const w = labelWidth(text);
  if (b.x + pad + w <= gridW) return { x: b.x + pad, anchor: "start" };
  const end = Math.min(b.x + b.w - pad, gridW - 0.05);
  if (end - w >= 0) return { x: end, anchor: "end" };
  return { x: 0.05, anchor: "start" };
}

/** An axis-aligned wall segment between two grid intersections (cell units). */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The grid intersection (line crossing) nearest the pointer, clamped to 0..gridW / 0..gridH. */
export function clientToIntersection(clientX: number, clientY: number, r: ClientRect, gridW: number, gridH: number): Cell {
  const p = clientToPoint(clientX, clientY, r, gridW, gridH);
  return { x: clamp(Math.round(p.x), 0, gridW), y: clamp(Math.round(p.y), 0, gridH) };
}

/** The wall segment from intersection a to b, low end first; null unless they share a row or column and differ. */
export function segmentBetween(a: Cell, b: Cell): Segment | null {
  if (a.x === b.x && a.y === b.y) return null;
  if (a.x !== b.x && a.y !== b.y) return null;
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
}

/** Distance from point p to segment s, in cell units. */
function distToSegment(s: Segment, p: Cell): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy));
}

/**
 * Id of the segment nearest point p (grid units) within `tol` cells, or null. On a tie a door or
 * window wins over a plain wall, so one drawn on top of a wall run can still be picked.
 */
export function hitSegment(walls: readonly (Segment & { id: string; kind?: string })[], p: Cell, tol: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  let bestWall = true;
  for (const w of walls) {
    const d = distToSegment(w, p);
    const isWall = (w.kind ?? "wall") === "wall";
    const tie = Math.abs(d - bestD) < 1e-9;
    if (d <= tol && (tie ? bestWall && !isWall : d < bestD)) {
      best = w.id;
      bestD = d;
      bestWall = isWall;
    }
  }
  return best;
}
