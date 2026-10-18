import { describe, expect, it } from "vitest";
import { describeFeatures, entryCell, featureCenter, featureFromBox, litFeatureCells, spawnCell } from "./features.js";
import { MapFeature } from "./schemas.js";

const loc = (features: MapFeature[]) => ({ gridW: 22, gridH: 14, features });

describe("map features", () => {
  it("converts a normalized image box to grid cells", () => {
    // altar near top, right of centre on a 22x14 board
    const f = featureFromBox({ name: "altar", kind: "focal", lit: true, box: [0.54, 0.08, 0.71, 0.37] }, 22, 14);
    expect(f).toEqual({ name: "altar", kind: "focal", lit: true, x: 11, y: 1, w: 5, h: 5 });
  });

  it("clamps boxes to the grid and keeps at least one cell", () => {
    expect(featureFromBox({ name: "door", kind: "entrance", lit: false, box: [-0.2, 0.45, 0.0, 0.5] }, 22, 14)).toMatchObject({ x: 0, y: 6, w: 1, h: 1 });
    expect(featureFromBox({ name: "far", kind: "feature", lit: false, box: [1.2, 1.1, 1.4, 1.3] }, 22, 14)).toMatchObject({ x: 21, y: 13, w: 1, h: 1 });
    // swapped corners are tolerated
    expect(featureFromBox({ name: "x", kind: "feature", lit: false, box: [0.5, 0.5, 0.25, 0.25] }, 20, 20)).toMatchObject({ x: 5, y: 5, w: 5, h: 5 });
  });

  it("finds the centre cell of a feature", () => {
    expect(featureCenter(MapFeature.parse({ name: "a", x: 11, y: 1, w: 5, h: 5 }))).toEqual({ x: 13, y: 3 });
    expect(featureCenter(MapFeature.parse({ name: "a", x: 4, y: 4, w: 2, h: 2 }))).toEqual({ x: 4, y: 4 });
  });

  it("enters at the entrance, one step inside the board edge", () => {
    expect(entryCell(loc([MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 6, w: 1, h: 2 })]))).toEqual({ x: 1, y: 6 });
    expect(entryCell(loc([MapFeature.parse({ name: "stairs", kind: "entrance", x: 10, y: 13 })]))).toEqual({ x: 10, y: 12 });
    expect(entryCell(loc([]))).toEqual({ x: 1, y: 7 }); // default: left edge, middle row
  });

  it("spawns monsters at the focal feature, else toward the right", () => {
    expect(spawnCell(loc([MapFeature.parse({ name: "altar", kind: "focal", x: 11, y: 1, w: 5, h: 5 })]))).toEqual({ x: 13, y: 3 });
    expect(spawnCell(loc([]))).toEqual({ x: 19, y: 7 });
  });

  it("lights the area around lit features only", () => {
    const cells = new Set(litFeatureCells(loc([
      MapFeature.parse({ name: "altar", kind: "focal", lit: true, x: 13, y: 3 }),
      MapFeature.parse({ name: "pews", x: 5, y: 5 }),
    ])));
    expect(cells.has("13,3")).toBe(true);
    expect(cells.has("15,3")).toBe(true); // radius 2
    expect(cells.has("16,3")).toBe(false);
    expect(cells.has("5,5")).toBe(false);
  });

  it("describes features for the DM", () => {
    expect(describeFeatures([MapFeature.parse({ name: "altar", kind: "focal", lit: true, x: 11, y: 1, w: 5, h: 5 }), MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 6 })])).toBe(
      "- altar (focal, lit): x 11-15, y 1-5\n- door (entrance): x 0, y 6",
    );
    expect(describeFeatures([])).toBe("");
  });
});
