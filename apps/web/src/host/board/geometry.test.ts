import { describe, expect, it } from "vitest";
import { boxFromInputs, cellsOfRect, clientToCell, clientToPoint, hitCorner, moveFeature, rectBetween, resizeFeature, sameRect, featureLabelPlacement, labelWidth } from "./geometry";

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

  it("a zero-size board rect (tab hidden / not laid out yet) still yields an in-grid integer cell", () => {
    const c = clientToCell(10, 10, { left: 10, top: 10, width: 0, height: 0 }, 20, 10);
    expect(c).toEqual({ x: 0, y: 0 });
    expect(clientToPoint(10, 10, { left: 10, top: 10, width: 0, height: 0 }, 20, 10)).toEqual({ x: 0, y: 0 });
  });

  it("pulls off-grid or oversized boxes back inside the grid when moving or resizing", () => {
    // e.g. the outline's gridW was lowered after the map was read: feature x 18..22 on a 20-wide grid
    const r = resizeFeature({ x: 18, y: 2, w: 5, h: 2 }, "nw", { x: 17, y: 2 }, 20, 10);
    expect(r).toEqual({ x: 17, y: 2, w: 3, h: 2 });
    expect(moveFeature({ x: 0, y: 0, w: 25, h: 2 }, 0, 0, 20, 10)).toEqual({ x: 0, y: 0, w: 20, h: 2 });
    expect(moveFeature({ x: 30, y: 30, w: 2, h: 2 }, 0, 0, 20, 10)).toEqual({ x: 18, y: 8, w: 2, h: 2 });
  });

  it("handles single-cell drags, edge cells and 1x1 corners", () => {
    expect(cellsOfRect(rectBetween({ x: 19, y: 9 }, { x: 19, y: 9 }))).toEqual([[19, 9]]);
    expect(resizeFeature({ x: 0, y: 0, w: 1, h: 1 }, "nw", { x: -5, y: -5 }, 20, 10)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(hitCorner({ x: 3, y: 3, w: 1, h: 1 }, { x: 3.5, y: 3.5 }, 0.45)).toBeNull(); // centre of a 1x1 is a move
  });

  it("reads the feature panel's number fields without turning an empty field into 0", () => {
    const f = { x: 4, y: 4, w: 3, h: 2 };
    expect(boxFromInputs({ x: "6", y: "", w: "abc", h: "0" }, f, 20, 10)).toEqual({ x: 6, y: 4, w: 3, h: 1 });
    expect(boxFromInputs({ x: "19", y: "9", w: "5", h: "5" }, f, 20, 10)).toEqual({ x: 19, y: 9, w: 1, h: 1 });
    expect(boxFromInputs({ x: " 2.6 ", y: "-4", w: "2", h: "2" }, f, 20, 10)).toEqual({ x: 3, y: 0, w: 2, h: 2 });
  });
});

describe("featureLabelPlacement", () => {
  it("labels from the left edge when the name fits", () => {
    expect(featureLabelPlacement({ x: 1, y: 1, w: 2, h: 1 }, 20, "Crate")).toEqual({ x: 1.15, anchor: "start" });
  });

  it("anchors at the right edge when a left-anchored label would run off the board", () => {
    const p = featureLabelPlacement({ x: 17, y: 1, w: 2, h: 1 }, 20, "Open crate on the broken deck");
    expect(p.anchor).toBe("end");
    expect(p.x).toBeCloseTo(18.85);
  });

  it("a feature left of the middle with a long name also stays on the board", () => {
    const text = "Open crate on the broken deck rail";
    const p = featureLabelPlacement({ x: 9, y: 1, w: 1, h: 1 }, 20, text);
    const width = labelWidth(text);
    const left = p.anchor === "start" ? p.x : p.x - width;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(20);
  });
});
