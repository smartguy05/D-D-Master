import { describe, expect, it } from "vitest";
import { cellsOfRect, clientToCell, clientToPoint, hitCorner, moveFeature, rectBetween, resizeFeature, sameRect } from "./geometry";

const rect = { left: 100, top: 50, width: 400, height: 200 }; // a 20 x 10 grid drawn at 20 px per cell

describe("board geometry", () => {
  it("converts client pixels to fractional grid points and cells", () => {
    expect(clientToPoint(100, 50, rect, 20, 10)).toEqual({ x: 0, y: 0 });
    expect(clientToPoint(310, 160, rect, 20, 10)).toEqual({ x: 10.5, y: 5.5 });
    expect(clientToCell(310, 160, rect, 20, 10)).toEqual({ x: 10, y: 5 });
  });

  it("clamps cells to the grid when the pointer leaves the board", () => {
    expect(clientToCell(0, 0, rect, 20, 10)).toEqual({ x: 0, y: 0 });
    expect(clientToCell(9999, 9999, rect, 20, 10)).toEqual({ x: 19, y: 9 });
    expect(clientToCell(500, 250, rect, 20, 10)).toEqual({ x: 19, y: 9 }); // right/bottom edge
  });

  it("builds a normalized rectangle between two cells and lists its cells", () => {
    expect(rectBetween({ x: 5, y: 4 }, { x: 3, y: 2 })).toEqual({ x: 3, y: 2, w: 3, h: 3 });
    expect(rectBetween({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(cellsOfRect({ x: 3, y: 2, w: 2, h: 2 })).toEqual([[3, 2], [4, 2], [3, 3], [4, 3]]);
    expect(sameRect({ x: 1, y: 1, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(sameRect({ x: 1, y: 1, w: 2, h: 2 }, { x: 1, y: 2, w: 2, h: 2 })).toBe(false);
  });

  it("moves a feature and keeps it on the board", () => {
    const f = { x: 2, y: 2, w: 3, h: 2 };
    expect(moveFeature(f, 4, 1, 20, 10)).toEqual({ x: 6, y: 3, w: 3, h: 2 });
    expect(moveFeature(f, 100, 100, 20, 10)).toEqual({ x: 17, y: 8, w: 3, h: 2 });
    expect(moveFeature(f, -9, -9, 20, 10)).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it("resizes from any corner, keeping the opposite corner fixed and at least one cell", () => {
    const f = { x: 4, y: 4, w: 3, h: 2 }; // cells x 4-6, y 4-5
    expect(resizeFeature(f, "se", { x: 9, y: 8 }, 20, 10)).toEqual({ x: 4, y: 4, w: 6, h: 5 });
    expect(resizeFeature(f, "nw", { x: 2, y: 1 }, 20, 10)).toEqual({ x: 2, y: 1, w: 5, h: 5 });
    expect(resizeFeature(f, "ne", { x: 8, y: 5 }, 20, 10)).toEqual({ x: 4, y: 5, w: 5, h: 1 });
    expect(resizeFeature(f, "sw", { x: 6, y: 9 }, 20, 10)).toEqual({ x: 6, y: 4, w: 1, h: 6 });
    // dragging past the opposite corner collapses to one cell instead of flipping
    expect(resizeFeature(f, "se", { x: 0, y: 0 }, 20, 10)).toEqual({ x: 4, y: 4, w: 1, h: 1 });
    expect(resizeFeature(f, "nw", { x: 15, y: 15 }, 20, 10)).toEqual({ x: 6, y: 5, w: 1, h: 1 });
    // clamped to the grid
    expect(resizeFeature(f, "se", { x: 40, y: 40 }, 20, 10)).toEqual({ x: 4, y: 4, w: 16, h: 6 });
  });

  it("finds the corner handle under the pointer", () => {
    const f = { x: 4, y: 4, w: 3, h: 2 }; // box spans points 4..7 x 4..6
    expect(hitCorner(f, { x: 7.1, y: 6.1 }, 0.4)).toBe("se");
    expect(hitCorner(f, { x: 4, y: 4 }, 0.4)).toBe("nw");
    expect(hitCorner(f, { x: 6.8, y: 4.2 }, 0.4)).toBe("ne");
    expect(hitCorner(f, { x: 4.3, y: 5.8 }, 0.4)).toBe("sw");
    expect(hitCorner(f, { x: 5.5, y: 5 }, 0.4)).toBeNull();
  });
});
