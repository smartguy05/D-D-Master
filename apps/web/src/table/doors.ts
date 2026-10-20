/**
 * TV doors (W3): where a door segment of the current location's walls sits in world space.
 * World space matches MapBoard's cellToWorld: grid point (gx, gy) -> (gx - gridW/2, gy - gridH/2)
 * on the x/z plane. The slab's length runs along its local x axis.
 */
import { cellKey, type WallSeg } from "@dm/shared";

export const DOOR_THICKNESS = 0.12;
export const DOOR_HEIGHT = 0.8;

export interface DoorTransform {
  position: [number, number, number];
  /** Rotation about the world Y axis (three.js convention: +angle turns local +x toward -z). */
  rotationY: number;
  length: number;
}

type Seg = Pick<WallSeg, "x1" | "y1" | "x2" | "y2" | "open">;

/**
 * A closed door lies along its grid edge. An open door swings a quarter turn about its first end
 * (x1, y1), so it sticks out of the wall at a right angle and the doorway is clear.
 */
export function doorTransform(seg: Seg, loc: { gridW: number; gridH: number }): DoorTransform {
  const ax = seg.x1 - loc.gridW / 2;
  const az = seg.y1 - loc.gridH / 2;
  const bx = seg.x2 - loc.gridW / 2;
  const bz = seg.y2 - loc.gridH / 2;
  const length = Math.hypot(bx - ax, bz - az);
  const y = DOOR_HEIGHT / 2;
  if (length === 0) return { position: [ax, y, az], rotationY: 0, length: 0 };
  let dx = (bx - ax) / length;
  let dz = (bz - az) / length;
  if (!seg.open) return { position: [(ax + bx) / 2, y, (az + bz) / 2], rotationY: -Math.atan2(dz, dx), length };
  // Swing about the hinge (a): the slab now points along the edge's perpendicular.
  [dx, dz] = [-dz, dx];
  return { position: [ax + (dx * length) / 2, y, az + (dz * length) / 2], rotationY: -Math.atan2(dz, dx), length };
}

/**
 * Whether the TV may draw a door: always without fog; with fog, only once a cell on either side
 * of it has been explored, so doors deep in unexplored fog do not give the layout away.
 */
export function doorVisible(seg: Pick<WallSeg, "x1" | "y1" | "x2" | "y2">, revealed: ReadonlySet<string> | null): boolean {
  if (!revealed) return true;
  const lo = (a: number, b: number) => Math.min(a, b);
  const hi = (a: number, b: number) => Math.max(a, b);
  if (seg.x1 === seg.x2) {
    for (let y = lo(seg.y1, seg.y2); y < hi(seg.y1, seg.y2); y++) if (revealed.has(cellKey(seg.x1 - 1, y)) || revealed.has(cellKey(seg.x1, y))) return true;
  } else {
    for (let x = lo(seg.x1, seg.x2); x < hi(seg.x1, seg.x2); x++) if (revealed.has(cellKey(x, seg.y1 - 1)) || revealed.has(cellKey(x, seg.y1))) return true;
  }
  return false;
}
