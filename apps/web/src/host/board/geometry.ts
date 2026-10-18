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

/** Pointer position in fractional grid units (0..gridW, 0..gridH), not clamped. */
export function clientToPoint(clientX: number, clientY: number, r: ClientRect, gridW: number, gridH: number): Cell {
  return { x: ((clientX - r.left) / r.width) * gridW, y: ((clientY - r.top) / r.height) * gridH };
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

/** Shift a box by (dx, dy) cells, keeping its size and keeping it fully on the board. */
export function moveFeature(f: Rect, dx: number, dy: number, gridW: number, gridH: number): Rect {
  return { x: clamp(f.x + dx, 0, Math.max(0, gridW - f.w)), y: clamp(f.y + dy, 0, Math.max(0, gridH - f.h)), w: f.w, h: f.h };
}

/**
 * Drag one corner of a box to `cell` (clamped to the board). The opposite corner stays put; the
 * box never flips past it and never shrinks below one cell.
 */
export function resizeFeature(f: Rect, corner: Corner, cell: Cell, gridW: number, gridH: number): Rect {
  const cx = clamp(cell.x, 0, gridW - 1);
  const cy = clamp(cell.y, 0, gridH - 1);
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
