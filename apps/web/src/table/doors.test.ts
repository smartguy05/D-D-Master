import { describe, expect, it } from "vitest";
import { doorTransform, doorVisible } from "./doors";

// TV doors (W3): a door segment of the current location's walls becomes a thin slab along its grid
// edge. World space matches MapBoard's cellToWorld: grid point (gx, gy) -> (gx - gridW/2, gy - gridH/2)
// on the x/z plane (a cell centre is +0.5).

type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
const loc = { gridW: 10, gridH: 8 };
const door = (x1: number, y1: number, x2: number, y2: number, open = false): Seg => ({ id: "d1", x1, y1, x2, y2, kind: "door", open });
type T = { position: [number, number, number]; rotationY: number; length: number };
const turn = (a: number) => ((a % Math.PI) + Math.PI) % Math.PI; // direction of a line, 0..PI

describe("doorTransform", () => {
  it("a closed horizontal door lies on its edge: centred on it, as long as it", () => {
    const t = doorTransform(door(3, 4, 5, 4), loc) as T;
    expect(t.length).toBeCloseTo(2);
    expect(t.position[0]).toBeCloseTo(4 - 5);
    expect(t.position[2]).toBeCloseTo(4 - 4);
    expect(t.position[1]).toBeGreaterThan(0);
    expect(turn(t.rotationY)).toBeCloseTo(0);
  });

  it("a closed vertical door is turned a quarter", () => {
    const t = doorTransform(door(6, 2, 6, 3), loc) as T;
    expect(t.length).toBeCloseTo(1);
    expect(t.position[0]).toBeCloseTo(6 - 5);
    expect(t.position[2]).toBeCloseTo(2.5 - 4);
    expect(turn(t.rotationY)).toBeCloseTo(Math.PI / 2);
  });

  it("an open door swings about 90 degrees around one end", () => {
    const closed = doorTransform(door(3, 4, 5, 4), loc) as T;
    const open = doorTransform(door(3, 4, 5, 4, true), loc) as T;
    expect(open.length).toBeCloseTo(closed.length);
    expect(turn(open.rotationY)).toBeCloseTo(Math.PI / 2);
    // the hinge end stays on one of the segment's endpoints: the slab centre is half a length from it
    const ends = [[3 - 5, 4 - 4], [5 - 5, 4 - 4]];
    const d = Math.min(...ends.map(([x, z]) => Math.hypot(open.position[0] - x!, open.position[2] - z!)));
    expect(d).toBeCloseTo(open.length / 2);
  });
});

describe("doorVisible", () => {
  it("is always true without fog", () => {
    expect(doorVisible(door(3, 4, 5, 4), null)).toBe(true);
  });
  it("needs an explored cell on either side of the door", () => {
    const v = door(6, 2, 6, 3); // between (5,2) and (6,2)
    expect(doorVisible(v, new Set())).toBe(false);
    expect(doorVisible(v, new Set(["5,2"]))).toBe(true);
    expect(doorVisible(v, new Set(["6,2"]))).toBe(true);
    expect(doorVisible(v, new Set(["6,3", "4,2"]))).toBe(false);
    const h = door(3, 4, 5, 4); // cells (3..4, 3) above and (3..4, 4) below
    expect(doorVisible(h, new Set(["4,3"]))).toBe(true);
    expect(doorVisible(h, new Set(["4,4"]))).toBe(true);
    expect(doorVisible(h, new Set(["5,4", "2,3"]))).toBe(false);
  });
});
