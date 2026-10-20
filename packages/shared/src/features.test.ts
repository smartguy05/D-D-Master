import { describe, expect, it } from "vitest";
import { describeFeatures, effectiveFeatures, effectiveWalls, entryCell, featureCenter, featureFromBox, litFeatureCells, spawnCell, wallsFromLines } from "./features.js";
import { GameState, Location, MapFeature, WallEdit, WallSeg, emptyGameState } from "./schemas.js";

const loc = (features: MapFeature[]) => ({ gridW: 22, gridH: 14, features });

describe("map features", () => {
  it("converts a normalized image box to grid cells", () => {
    // altar near top, right of centre on a 22x14 board
    const f = featureFromBox({ name: "altar", kind: "focal", lit: true, box: [0.54, 0.08, 0.71, 0.37] }, 22, 14);
    expect(f).toEqual({ name: "altar", kind: "focal", lit: true, blocks: false, interactive: false, x: 11, y: 1, w: 5, h: 5 });
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

// ---- Phase 1: walls, doors, line of sight (S1, S2, S3, F2, D1) ----

describe("wall schema (S1, S2)", () => {
  it("WallSeg defaults kind to wall and open to false", () => {
    const w = WallSeg.parse({ id: "w1", x1: 3, y1: 0, x2: 3, y2: 5 });
    expect(w).toEqual({ id: "w1", x1: 3, y1: 0, x2: 3, y2: 5, kind: "wall", open: false });
    expect(WallSeg.parse({ id: "d1", x1: 0, y1: 0, x2: 1, y2: 0, kind: "door", open: true }).open).toBe(true);
    expect(() => WallSeg.parse({ id: "x", x1: -1, y1: 0, x2: 1, y2: 0 })).toThrow();
    expect(() => WallSeg.parse({ id: "x", x1: 0.5, y1: 0, x2: 1, y2: 0 })).toThrow();
    expect(() => WallSeg.parse({ id: "x", x1: 0, y1: 0, x2: 1, y2: 0, kind: "fence" })).toThrow();
  });

  it("an old Location without walls parses to walls []", () => {
    const old = JSON.parse(JSON.stringify({ id: "loc_a", name: "A", gridW: 10, gridH: 8, features: [] }));
    expect(Location.parse(old).walls).toEqual([]);
  });

  it("an old saved GameState without wallEdits parses to {}, and emptyGameState has {}", () => {
    const old = JSON.parse(JSON.stringify({ campaignId: "old", locationId: "loc_a", featureEdits: {}, fog: { loc_a: { enabled: true, revealed: ["1,1"] } } }));
    expect(GameState.parse(old).wallEdits).toEqual({});
    expect(emptyGameState("c").wallEdits).toEqual({});
  });

  it("WallEdit defaults walls to [] and has no mapUrl gate", () => {
    expect(WallEdit.parse({})).toEqual({ walls: [], host: true }); // an old save's edit counts as a host fix
    const s = GameState.parse({ campaignId: "c", wallEdits: { loc_a: { walls: [{ id: "w1", x1: 1, y1: 0, x2: 1, y2: 4 }] } } });
    expect(s.wallEdits.loc_a!.walls[0]).toMatchObject({ kind: "wall", open: false });
  });
});

describe("effectiveWalls (S3)", () => {
  // Plain objects (not parsed at collection time, so a missing WallSeg export fails per test).
  const detected = { id: "w1", x1: 3, y1: 0, x2: 3, y2: 5, kind: "wall" as const, open: false };
  const edited = { id: "w9", x1: 6, y1: 0, x2: 6, y2: 2, kind: "door" as const, open: false };
  const loc = { ...Location.parse({ id: "loc_a", name: "A", mapUrl: "/m/1.png" }), walls: [detected] } as Location;

  it("uses the location's walls without an edit, [] for a location without walls", () => {
    expect(effectiveWalls(GameState.parse({ campaignId: "c" }), loc)).toEqual([detected]);
    const bare = { ...Location.parse({ id: "loc_b", name: "B" }) } as Partial<Location> & { id: string };
    delete bare.walls;
    expect(effectiveWalls(GameState.parse({ campaignId: "c" }), bare as Location)).toEqual([]);
    expect(effectiveWalls(null as never, loc)).toEqual([detected]);
  });

  it("uses the host's edit whatever the map picture (no mapUrl gate)", () => {
    const s = GameState.parse({ campaignId: "c", wallEdits: { loc_a: { walls: [edited] } } });
    expect(effectiveWalls(s, loc)).toEqual([edited]);
    expect(effectiveWalls(s, { ...loc, mapUrl: "/m/2.png", walls: [] })).toEqual([edited]);
    expect(effectiveWalls(s, { ...loc, mapUrl: undefined })).toEqual([edited]);
    expect(effectiveWalls(s, { ...loc, id: "loc_other" })).toEqual([detected]);
  });

  it("an edit with an empty wall list wins over detected walls", () => {
    const s = GameState.parse({ campaignId: "c", wallEdits: { loc_a: { walls: [] } } });
    expect(effectiveWalls(s, loc)).toEqual([]);
  });
});

describe("litFeatureCells with walls (F2)", () => {
  const ws = (id: string, x1: number, y1: number, x2: number, y2: number, kind: WallSeg["kind"] = "wall", open = false): WallSeg => ({ id, x1, y1, x2, y2, kind, open });
  const lamp = MapFeature.parse({ name: "brazier", lit: true, x: 5, y: 5 });
  it("without walls the glow is unchanged", () => {
    const base = new Set(litFeatureCells({ gridW: 14, gridH: 12, features: [lamp] }));
    const withEmpty = { gridW: 14, gridH: 12, features: [lamp], walls: [] as WallSeg[] };
    expect(new Set(litFeatureCells(withEmpty))).toEqual(base);
    expect(base.has("7,5")).toBe(true);
  });

  it("the glow does not cross a closed wall", () => {
    const walled = { gridW: 14, gridH: 12, features: [lamp], walls: [ws("w1", 6, 0, 6, 12)] };
    const cells = new Set(litFeatureCells(walled));
    expect(cells.has("5,5")).toBe(true);
    expect(cells.has("3,5")).toBe(true);
    for (const k of cells) expect(Number(k.split(",")[0])).toBeLessThan(6);
  });

  it("an open door lets the glow through", () => {
    const walls = [ws("w1", 6, 0, 6, 5), ws("d1", 6, 5, 6, 6, "door", true), ws("w2", 6, 6, 6, 12)];
    const cells = new Set(litFeatureCells({ gridW: 14, gridH: 12, features: [lamp], walls }));
    expect(cells.has("6,5")).toBe(true);
    expect(cells.has("7,5")).toBe(true);
  });
});

describe("wallsFromLines (D1)", () => {
  const norm = (w: WallSeg) => {
    const [a, b] = [[w.x1, w.y1], [w.x2, w.y2]].sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
    return { x1: a![0], y1: a![1], x2: b![0], y2: b![1], kind: w.kind, open: w.open };
  };
  const len = (w: WallSeg) => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);

  it("snaps a straight wall to grid intersections", () => {
    const out = wallsFromLines([{ kind: "wall", points: [[0.3, 0], [0.31, 0.5]] }], 10, 10);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("w1");
    expect(norm(out[0]!)).toEqual({ x1: 3, y1: 0, x2: 3, y2: 5, kind: "wall", open: false });
  });

  it("turns each polyline leg into axis-aligned segments", () => {
    const out = wallsFromLines([{ kind: "wall", points: [[0, 0], [0.5, 0], [0.5, 0.5]] }], 10, 10);
    for (const w of out) expect(w.x1 === w.x2 || w.y1 === w.y2).toBe(true);
    expect(out.reduce((s, w) => s + len(w), 0)).toBe(10);
    expect(out.map(norm)).toEqual(expect.arrayContaining([expect.objectContaining({ x1: 5, y1: 0, x2: 5, y2: 5 })]));
  });

  it("a diagonal leg becomes a staircase of unit edges", () => {
    const out = wallsFromLines([{ kind: "wall", points: [[0, 0], [0.2, 0.2]] }], 10, 10);
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const w of out) {
      expect(w.x1 === w.x2 || w.y1 === w.y2).toBe(true);
      expect(len(w)).toBeGreaterThan(0);
    }
    expect(out.reduce((s, w) => s + len(w), 0)).toBe(4);
    const ends = new Set(out.flatMap((w) => [`${w.x1},${w.y1}`, `${w.x2},${w.y2}`]));
    expect(ends.has("0,0")).toBe(true);
    expect(ends.has("2,2")).toBe(true);
  });

  it("clamps points to the grid and drops zero-length legs", () => {
    const out = wallsFromLines([{ kind: "wall", points: [[0.5, -0.3], [0.5, 1.4]] }], 10, 8);
    expect(out.map(norm)).toEqual([{ x1: 5, y1: 0, x2: 5, y2: 8, kind: "wall", open: false }]);
    expect(wallsFromLines([{ kind: "wall", points: [[0.31, 0.3], [0.29, 0.3]] }], 10, 10)).toEqual([]);
  });

  it("doors start closed with ids d1, d2 ...; walls get w1, w2 ...", () => {
    const out = wallsFromLines(
      [
        { kind: "wall", points: [[0.3, 0], [0.3, 0.4]] },
        { kind: "door", points: [[0.3, 0.4], [0.3, 0.5]] },
        { kind: "wall", points: [[0.3, 0.5], [0.3, 1]] },
        { kind: "door", points: [[0.6, 0.2], [0.7, 0.2]] },
        { kind: "window", points: [[0.8, 0], [0.8, 0.1]] },
      ],
      10,
      10,
    );
    const doors = out.filter((w) => w.kind === "door");
    expect(doors.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(doors.every((d) => d.open === false)).toBe(true);
    expect(norm(doors[0]!)).toMatchObject({ x1: 3, y1: 4, x2: 3, y2: 5 });
    const walls = out.filter((w) => w.kind === "wall");
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) expect(w.id).toMatch(/^w\d+$/);
    expect(out.filter((w) => w.kind === "window")).toHaveLength(1);
    expect(new Set(out.map((w) => w.id)).size).toBe(out.length);
  });

  it("a door narrower than a cell is kept as one unit edge, so the doorway is not sealed (review fix)", () => {
    const out = wallsFromLines(
      [
        { kind: "wall", points: [[0.1, 0.5], [0.4, 0.5]] },
        { kind: "door", points: [[0.4, 0.5], [0.43, 0.5]] },
        { kind: "wall", points: [[0.43, 0.5], [0.8, 0.5]] },
      ],
      24,
      10,
    );
    const doors = out.filter((w) => w.kind === "door");
    expect(doors.map(norm)).toEqual([{ x1: 9, y1: 5, x2: 10, y2: 5, kind: "door", open: false }]);
    expect(doors[0]!.id).toBe("d1");
    // the wall no longer runs under the doorway
    for (const w of out.filter((x) => x.kind === "wall")) expect(Math.min(w.x1, w.x2) >= 10 || Math.max(w.x1, w.x2) <= 9).toBe(true);
    // a vertical one (taller than wide) becomes a vertical unit edge
    const v = wallsFromLines([{ kind: "door", points: [[0.5, 0.41], [0.5, 0.44]] }], 10, 10);
    expect(v.map(norm)).toEqual([{ x1: 5, y1: 4, x2: 5, y2: 5, kind: "door", open: false }]);
  });

  it("is deterministic and removes overlapping duplicates", () => {
    const lines = [
      { kind: "wall" as const, points: [[0.3, 0], [0.3, 0.5]] as [number, number][] },
      { kind: "wall" as const, points: [[0.3, 0], [0.3, 0.5]] as [number, number][] },
    ];
    const a = wallsFromLines(lines, 10, 10);
    expect(a).toEqual(wallsFromLines(lines, 10, 10));
    expect(a.reduce((s, w) => s + len(w), 0)).toBe(5);
  });
});

describe("interactive map features (F1)", () => {
  it("featureFromBox passes the vision model's interactive flag through (default false)", () => {
    const box = { name: "lever", kind: "feature" as const, lit: false, box: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number] };
    expect((featureFromBox({ ...box, interactive: true } as Parameters<typeof featureFromBox>[0], 10, 10) as { interactive?: boolean }).interactive).toBe(true);
    expect((featureFromBox(box, 10, 10) as { interactive?: boolean }).interactive).toBe(false);
  });

  it("describeFeatures tags interactive features for the DM", () => {
    expect(describeFeatures([MapFeature.parse({ name: "Sluice lever", blocks: true, interactive: true, x: 17, y: 7 })])).toBe("- Sluice lever (blocks, interactive): x 17, y 7");
    expect(describeFeatures([MapFeature.parse({ name: "chest", interactive: true, x: 2, y: 3, w: 2 })])).toBe("- chest (interactive): x 2-3, y 3");
    expect(describeFeatures([MapFeature.parse({ name: "pews", blocks: true, x: 4, y: 3 })])).toBe("- pews (blocks): x 4, y 3");
  });
});
