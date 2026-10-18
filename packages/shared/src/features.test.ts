import { describe, expect, it } from "vitest";
import { describeFeatures, effectiveFeatures, entryCell, featureCenter, featureFromBox, litFeatureCells, spawnCell } from "./features.js";
import { GameState, Location, MapFeature } from "./schemas.js";

const loc = (features: MapFeature[]) => ({ gridW: 22, gridH: 14, features });

describe("map features", () => {
  it("converts a normalized image box to grid cells", () => {
    // altar near top, right of centre on a 22x14 board
    const f = featureFromBox({ name: "altar", kind: "focal", lit: true, box: [0.54, 0.08, 0.71, 0.37] }, 22, 14);
    expect(f).toEqual({ name: "altar", kind: "focal", lit: true, blocks: false, x: 11, y: 1, w: 5, h: 5 });
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
    expect(describeFeatures([MapFeature.parse({ name: "pews", blocks: true, x: 4, y: 3, w: 2 })])).toBe("- pews (blocks): x 4-5, y 3");
  });

  it("passes the vision model's blocks flag through", () => {
    expect(featureFromBox({ name: "pillar", kind: "feature", lit: false, blocks: true, box: [0.1, 0.1, 0.2, 0.2] }, 10, 10).blocks).toBe(true);
  });
});

describe("effective features (host edits)", () => {
  const altar = MapFeature.parse({ name: "altar", kind: "focal", x: 11, y: 1, w: 5, h: 4 });
  const moved = MapFeature.parse({ name: "altar", kind: "focal", x: 3, y: 3, w: 2, h: 2 });
  const loc = Location.parse({ id: "loc_a", name: "A", mapUrl: "/m/1.png", features: [altar] });

  it("old saves without featureEdits / blocks still parse", () => {
    const s = GameState.parse({ campaignId: "old" });
    expect(s.featureEdits).toEqual({});
    expect(MapFeature.parse({ name: "x", x: 0, y: 0 }).blocks).toBe(false);
    expect(effectiveFeatures(s, loc)).toEqual([altar]);
  });

  it("uses the host's edit while it was made for the current map picture", () => {
    const s = GameState.parse({ campaignId: "c", featureEdits: { loc_a: { mapUrl: "/m/1.png", features: [moved] } } });
    expect(effectiveFeatures(s, loc)).toEqual([moved]);
    expect(effectiveFeatures(s, { ...loc, id: "loc_b" })).toEqual([altar]);
  });

  it("ignores the edit once the map is repainted", () => {
    const s = GameState.parse({ campaignId: "c", featureEdits: { loc_a: { mapUrl: "/m/1.png", features: [moved] } } });
    expect(effectiveFeatures(s, { ...loc, mapUrl: "/m/2.png", features: [] })).toEqual([]);
  });

  it("an edit on a location without a map applies until a map is painted", () => {
    const bare = Location.parse({ id: "loc_a", name: "A" });
    const s = GameState.parse({ campaignId: "c", featureEdits: { loc_a: { features: [moved] } } });
    expect(effectiveFeatures(s, bare)).toEqual([moved]);
    expect(effectiveFeatures(s, { ...bare, mapUrl: "/m/1.png" })).toEqual([]);
  });
});
