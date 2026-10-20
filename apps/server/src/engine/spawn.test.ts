import { describe, expect, it } from "vitest";
import { Character, GameState, Location, MapFeature, cellKey, emptyGameState } from "@dm/shared";
import { ensureCharacterTokens, executeEngineTool, restageForMap, type EngineContext } from "./tools.js";
import { MIN_PC_DISTANCE, findFeature, planSpawn } from "./spawn.js";
import { blockedCells, nearestFreeCell } from "./state.js";

const door = MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 5, w: 1, h: 2 });
const altar = MapFeature.parse({ name: "Altar of Bones", kind: "focal", blocks: true, x: 12, y: 4, w: 3, h: 3 });
const pillar = MapFeature.parse({ name: "pillar", blocks: true, x: 8, y: 2, w: 1, h: 1 });
const rug = MapFeature.parse({ name: "red rug", x: 4, y: 9, w: 3, h: 2 });
const hall: Location = { id: "loc_hall", name: "Hall", description: "", mapPrompt: "", mapUrl: "/m/h.png", fog: false, gridW: 20, gridH: 12, walls: [], features: [door, altar, pillar, rug] };

function ctx(locations: Location[] = [hall]): EngineContext {
  return { rng: () => 10, monsterTemplate: () => undefined, spell: () => undefined, spellCandidates: () => [], classData: () => undefined, locations };
}

function party(c = ctx(), loc = "loc_hall"): GameState {
  let s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 3 }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 8, hp: 8, lightRadius: 3 }),
  );
  return executeEngineTool(s, "change_scene", { location_id: loc }, c).state;
}

const run = (s: GameState, args: Record<string, unknown>, c = ctx()) => executeEngineTool(s, "spawn_monster", { name: "Goblin", ...args }, c);
const monsterCells = (s: GameState) => s.tokens.filter((t) => t.entityType === "monster").map((t) => ({ x: t.x, y: t.y }));
const pcCells = (s: GameState) => s.tokens.filter((t) => t.entityType === "character");
const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const grid = (loc: Location = hall) => ({ gridW: loc.gridW, gridH: loc.gridH, features: loc.features });

function expectDistinct(cells: { x: number; y: number }[]) {
  expect(new Set(cells.map((c) => cellKey(c.x, c.y))).size).toBe(cells.length);
}

describe("planSpawn", () => {
  it("never stacks monsters or lands on blocked or occupied cells", () => {
    let s = party();
    s = run(s, { count: 6 }).state;
    s = run(s, { count: 6, near: "pillar" }).state;
    const cells = monsterCells(s);
    expect(cells).toHaveLength(12);
    const all = s.tokens.map((t) => ({ x: t.x, y: t.y }));
    expectDistinct(all);
    const blocked = blockedCells(hall.features, hall.gridW, hall.gridH);
    for (const c of cells) expect(blocked.has(cellKey(c.x, c.y))).toBe(false);
  });

  it("cluster is a compact blob around the anchor, not a line", () => {
    const s = party();
    const cells = planSpawn(s, grid({ ...hall, features: [door] }), 5, { anchor: { x: 15, y: 6 } });
    expectDistinct(cells);
    for (const c of cells) expect(cheb(c, { x: 15, y: 6 })).toBeLessThanOrEqual(1);
    expect(new Set(cells.map((c) => c.x)).size).toBeGreaterThan(1);
    expect(new Set(cells.map((c) => c.y)).size).toBeGreaterThan(1);
    expect(cells[0]).toEqual({ x: 15, y: 6 });
  });

  it("line lines up across the facing direction", () => {
    const s = party();
    const cells = planSpawn(s, grid({ ...hall, features: [door] }), 4, { anchor: { x: 15, y: 6 }, formation: "line" });
    // the party is to the left: a vertical line through the anchor
    expect(new Set(cells.map((c) => c.x))).toEqual(new Set([15]));
    expectDistinct(cells);
  });

  it("keeps at least 3 cells from the nearest PC when the room allows", () => {
    const s = party();
    const pcs = pcCells(s);
    // anchor right on the party
    const cells = planSpawn(s, grid(), 6, { anchor: { x: pcs[0].x + 1 } });
    for (const c of cells) for (const p of pcs) expect(cheb(c, p)).toBeGreaterThanOrEqual(MIN_PC_DISTANCE);
  });

  it("an exact x and y is honoured even next to a PC (the DM chose the spot)", () => {
    let s = party();
    const p = pcCells(s)[0];
    s = run(s, { x: p.x + 1, y: p.y }).state;
    expect(monsterCells(s)[0]).toEqual({ x: p.x + 1, y: p.y });
  });

  it("explicit x/y overrides the near anchor", () => {
    const s = run(party(), { near: "pillar", x: 17, y: 10 }).state;
    expect(monsterCells(s)[0]).toEqual({ x: 17, y: 10 });
  });

  it("arc faces the party centroid at roughly equal distance", () => {
    const s = party();
    const anchor = { x: 15, y: 6 };
    const cells = planSpawn(s, grid({ ...hall, features: [door] }), 5, { anchor, formation: "arc" });
    expectDistinct(cells);
    const pcs = pcCells(s);
    const px = pcs.reduce((a, t) => a + t.x, 0) / pcs.length;
    for (const c of cells) {
      expect(c.x).toBeLessThan(anchor.x); // on the party's side (the party is to the left)
      expect(Math.abs(c.x - anchor.x) - Math.abs(px - anchor.x)).toBeLessThan(0);
    }
    const dists = cells.map((c) => Math.hypot(c.x - anchor.x, c.y - anchor.y));
    expect(Math.max(...dists) - Math.min(...dists)).toBeLessThanOrEqual(1.5);
  });

  it("arc turns to face a party on the other side", () => {
    let s = party();
    for (const t of pcCells(s)) t.x = 19;
    const cells = planSpawn(s, grid({ ...hall, features: [door] }), 3, { anchor: { x: 10, y: 6 }, formation: "arc" });
    for (const c of cells) expect(c.x).toBeGreaterThan(10);
  });

  it("near places around a blocking feature's footprint, not on it", () => {
    const s = run(party(), { near: "altar", count: 4 }).state;
    const blocked = blockedCells([altar], hall.gridW, hall.gridH);
    for (const c of monsterCells(s)) {
      expect(blocked.has(cellKey(c.x, c.y))).toBe(false);
      const d = Math.max(Math.max(altar.x - c.x, 0, c.x - (altar.x + 2)), Math.max(altar.y - c.y, 0, c.y - (altar.y + 2)));
      expect(d).toBe(1); // hugging the altar
    }
  });

  it("without near, a blocking focal feature is the anchor: around it, on the party's side first", () => {
    const s = run(party(), { count: 3 }).state;
    const blocked = blockedCells([altar], hall.gridW, hall.gridH);
    for (const c of monsterCells(s)) {
      expect(blocked.has(cellKey(c.x, c.y))).toBe(false);
      expect(c.x).toBe(altar.x - 1); // the party is to the left
    }
  });

  it("near matches by name: exact, prefix, contains, any case", () => {
    expect(findFeature(hall.features, "PILLAR").name).toBe("pillar");
    expect(findFeature(hall.features, "altar").name).toBe("Altar of Bones");
    expect(findFeature(hall.features, "bones").name).toBe("Altar of Bones");
    expect(findFeature(hall.features, "rug").name).toBe("red rug");
    const s = run(party(), { near: "rug", count: 2 }).state;
    for (const c of monsterCells(s)) expect(c.y).toBeGreaterThanOrEqual(8);
  });

  it("an unknown feature name is a clear error listing the features", () => {
    expect(() => run(party(), { near: "throne" })).toThrow(/No map feature matches "throne".*door, Altar of Bones, pillar, red rug/);
    const bare = { ...hall, features: [] };
    expect(() => run(party(ctx([bare])), { near: "throne" }, ctx([bare]))).toThrow(/no features/);
  });

  it("prefers cells matching the fog preference", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    const seen = new Set(s.fog.loc_hall.revealed);
    expect(seen.size).toBeGreaterThan(0);
    const hidden = planSpawn(s, grid(), 4, { fog: "hidden", anchor: { x: 4, y: 5 } });
    for (const c of hidden) expect(seen.has(cellKey(c.x, c.y))).toBe(false);
    const shown = planSpawn(s, grid(), 4, { fog: "revealed", anchor: { x: 15, y: 6 } });
    for (const c of shown) expect(seen.has(cellKey(c.x, c.y))).toBe(true);
  });

  it("falls back to any legal cell when the fog preference cannot be met", () => {
    const s = party(); // fog off: every cell is visible, so nothing is "hidden"
    const cells = planSpawn(s, grid(), 3, { fog: "hidden", anchor: { x: 16, y: 6 } });
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(cheb(c, { x: 16, y: 6 })).toBeLessThanOrEqual(1);
  });

  it("degrades gracefully in a small room (closest legal cells, no stacking)", () => {
    const closet: Location = { id: "loc_closet", name: "Closet", description: "", mapPrompt: "", fog: false, gridW: 4, gridH: 4, walls: [], features: [] };
    const c = ctx([closet]);
    let s = party(c, "loc_closet");
    s = executeEngineTool(s, "spawn_monster", { name: "Rat", count: 5 }, c).state;
    expect(monsterCells(s)).toHaveLength(5);
    expectDistinct(s.tokens.map((t) => ({ x: t.x, y: t.y })));
  });

  it("a fully blocked board still places every monster without throwing", () => {
    const wall = MapFeature.parse({ name: "rock", blocks: true, x: 0, y: 0, w: 4, h: 4 });
    const cave: Location = { id: "loc_rock", name: "Rock", description: "", mapPrompt: "", fog: false, gridW: 4, gridH: 4, walls: [], features: [wall] };
    const c = ctx([cave]);
    let s = party(c, "loc_rock");
    expect(pcCells(s)).toHaveLength(2);
    s = executeEngineTool(s, "spawn_monster", { name: "Rat", count: 3 }, c).state;
    expect(monsterCells(s)).toHaveLength(3);
    expectDistinct(s.tokens.map((t) => ({ x: t.x, y: t.y })));
    // more creatures than cells: they stack instead of failing
    const many = planSpawn(s, grid(cave), 20);
    expect(many).toHaveLength(20);
  });

  it("spawns already hidden for an ambush", () => {
    let s = run(party(), { count: 2, hidden: true }).state;
    expect(s.monsters.every((m) => m.hidden)).toBe(true);
    s = run(s, { name: "Rat" }).state;
    expect(s.monsters.at(-1)!.hidden).toBe(false);
  });

  it("is deterministic and does not modify the input state", () => {
    const s = party();
    const before = structuredClone(s);
    const a = planSpawn(s, grid(), 5, { formation: "arc", near: "altar" });
    const b = planSpawn(s, grid(), 5, { formation: "arc", near: "altar" });
    expect(a).toEqual(b);
    expect(s).toEqual(before);
    const out = run(s, { count: 3 });
    expect(s).toEqual(before);
    expect(out.state.monsters).toHaveLength(3);
  });

  it("old saves (no blocks, no featureEdits) still spawn", () => {
    const oldLoc = Location.parse({ id: "loc_old", name: "Old", gridW: 12, gridH: 8, features: [{ name: "lair", kind: "focal", x: 9, y: 3 }] });
    const c = ctx([oldLoc]);
    const raw = JSON.parse(JSON.stringify(party(c, "loc_old")));
    delete raw.featureEdits;
    const s = GameState.parse(raw);
    const out = executeEngineTool(s, "spawn_monster", { name: "Goblin", count: 2 }, c).state;
    expect(monsterCells(out)[0]).toEqual({ x: 9, y: 3 });
    expectDistinct(monsterCells(out));
  });
});

describe("nearestFreeCell and blocking features", () => {
  it("skips blocked cells, including a blocked start cell", () => {
    const s = emptyGameState("c1");
    const cell = nearestFreeCell(s, 13, 5, 20, 12, [altar]);
    expect(blockedCells([altar], 20, 12).has(cellKey(cell.x, cell.y))).toBe(false);
    expect(cheb(cell, { x: 13, y: 5 })).toBe(2);
  });

  it("falls back to a free blocked cell, then the start, on a full board", () => {
    const wall = MapFeature.parse({ name: "rock", blocks: true, x: 0, y: 0, w: 4, h: 4 });
    const s = emptyGameState("c1");
    expect(nearestFreeCell(s, 1, 1, 4, 4, [wall])).toEqual({ x: 1, y: 1 });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s.tokens.push({ id: `t${x}${y}`, entityId: `e${x}${y}`, entityType: "monster", x, y, size: 1 });
    expect(nearestFreeCell(s, 9, 9, 4, 4, [wall])).toEqual({ x: 3, y: 3 });
  });

  it("move_token onto a blocked cell moves to the nearest free one", () => {
    const s = executeEngineTool(party(), "move_token", { entity_id: "pc_a", x: 13, y: 5 }, ctx()).state;
    const t = s.tokens.find((x) => x.entityId === "pc_a")!;
    expect(blockedCells(hall.features, 20, 12).has(cellKey(t.x, t.y))).toBe(false);
  });

  it("the party avoids a blocked entrance cell", () => {
    const crate = MapFeature.parse({ name: "crate", blocks: true, x: 1, y: 5, w: 1, h: 2 });
    const loc = { ...hall, features: [door, crate] };
    const s = party(ctx([loc]));
    for (const t of pcCells(s)) expect(t.x === 1 && (t.y === 5 || t.y === 6)).toBe(false);
  });
});

/** A bare state with PC tokens (and other tokens) at the given cells, for planSpawn unit tests. */
function tokensAt(pcs: [number, number][], others: [number, number][] = []): GameState {
  const s = emptyGameState("c1");
  pcs.forEach(([x, y], i) => s.tokens.push({ id: "t" + i, entityId: "pc" + i, entityType: "character", x, y, size: 1 }));
  others.forEach(([x, y], i) => s.tokens.push({ id: "o" + i, entityId: "m" + i, entityType: "monster", x, y, size: 1 }));
  return s;
}
const centroid = (cs: { x: number; y: number }[]) => ({ x: cs.reduce((a, c) => a + c.x, 0) / cs.length, y: cs.reduce((a, c) => a + c.y, 0) / cs.length });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const smallAltar = MapFeature.parse({ name: "Altar", kind: "focal", blocks: true, x: 9, y: 5, w: 2, h: 2 });
const G = (w: number, h: number, f: MapFeature[] = []) => ({ gridW: w, gridH: h, features: f });
const connected = (cells: { x: number; y: number }[]) => {
  for (const a of cells) expect(Math.min(...cells.filter((b) => b !== a).map((b) => cheb(a, b)))).toBeLessThanOrEqual(1);
};

describe("formations near the party", () => {
  it("a 12-monster arc stays on the anchor's side instead of wrapping around the party", () => {
    const s = tokensAt([[2, 6], [2, 7]]);
    const cells = planSpawn(s, G(20, 12, [smallAltar]), 12, { formation: "arc" });
    expectDistinct(cells);
    const c = centroid(cells);
    expect(dist(c, { x: 9.5, y: 5.5 })).toBeLessThan(dist(c, { x: 2, y: 6.5 }));
    for (const m of cells) expect(m.x).toBeGreaterThan(2); // nobody behind the party
  });

  it("a line anchored next to the party is shifted away and stays one connected line", () => {
    const s = tokensAt([[2, 6], [2, 7]]);
    const cells = planSpawn(s, G(20, 12, [smallAltar]), 6, { anchor: { x: 3 }, formation: "line" });
    connected(cells);
    for (const m of cells) for (const p of [{ x: 2, y: 6 }, { x: 2, y: 7 }]) expect(cheb(m, p)).toBeGreaterThanOrEqual(MIN_PC_DISTANCE);
  });

  it("a cluster anchored on the party is shifted away and stays one blob", () => {
    const s = tokensAt([[2, 6], [2, 7]]);
    const cells = planSpawn(s, G(20, 12, [smallAltar]), 6, { anchor: { x: 3 } });
    connected(cells);
    for (const m of cells) expect(cheb(m, { x: 2, y: 6 })).toBeGreaterThanOrEqual(MIN_PC_DISTANCE);
  });
});

describe("findFeature precedence", () => {
  it("exact name beats earlier prefix and substring matches", () => {
    const fs = [MapFeature.parse({ name: "Trapdoor", x: 1, y: 1 }), MapFeature.parse({ name: "Doorway", x: 3, y: 3 }), MapFeature.parse({ name: "Door", x: 5, y: 5 })];
    expect(findFeature(fs, "door").name).toBe("Door");
  });

  it("a whole-word match beats a substring ('door' -> 'Front door', not 'Trapdoor')", () => {
    const fs = [MapFeature.parse({ name: "Trapdoor", x: 1, y: 1 }), MapFeature.parse({ name: "Front door", x: 5, y: 5 })];
    expect(findFeature(fs, "door").name).toBe("Front door");
    expect(findFeature(fs, "trap").name).toBe("Trapdoor"); // prefix still beats whole word
  });
});

describe("move_token and blocking features", () => {
  const strip: Location = { id: "loc_s", name: "Strip", description: "", mapPrompt: "", fog: false, gridW: 3, gridH: 1, walls: [], features: [] };
  const stripCtx = (features: MapFeature[] = [], source?: "dm" | "host"): EngineContext => ({ ...ctx([{ ...strip, features }]), source });
  function onStrip(...others: number[]): GameState {
    const s = emptyGameState("c1");
    s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12 }));
    s.locationId = "loc_s";
    s.tokens.push({ id: "t1", entityId: "pc_a", entityType: "character", x: 0, y: 0, size: 1 });
    others.forEach((x, i) => s.tokens.push({ id: "m" + i, entityId: "mon" + i, entityType: "monster", x, y: 0, size: 1 }));
    return s;
  }
  const pcAt = (s: GameState) => s.tokens.find((t) => t.entityId === "pc_a")!;

  it("onto an occupied cell with no other room: the mover stays in its own cell (no stacking)", () => {
    const s = executeEngineTool(onStrip(1, 2), "move_token", { entity_id: "pc_a", x: 1, y: 0 }, stripCtx()).state;
    expect(new Set(s.tokens.map((t) => cellKey(t.x, t.y))).size).toBe(3);
    expect(pcAt(s)).toMatchObject({ x: 0, y: 0 });
  });

  it("the DM is redirected off a blocking feature and told why", () => {
    const crate = MapFeature.parse({ name: "crate", blocks: true, x: 1, y: 0 });
    const out = executeEngineTool(onStrip(), "move_token", { entity_id: "pc_a", x: 1, y: 0 }, stripCtx([crate]));
    expect(pcAt(out.state).x).not.toBe(1);
    expect(out.outcome.output).toMatchObject({ redirected: true, reason: "crate blocks that cell" });
    // Next to the crate: told it can use it from there (stops the DM hunting for a cell "at" it).
    expect((out.outcome.output as { note: string }).note).toBe("Thorin stands beside crate, close enough to use it. Leave the token there.");
  });

  it("the host may put a token on a blocking feature; an occupied cell still redirects", () => {
    const crate = MapFeature.parse({ name: "crate", blocks: true, x: 1, y: 0 });
    const out = executeEngineTool(onStrip(), "move_token", { entity_id: "pc_a", x: 1, y: 0 }, stripCtx([crate], "host"));
    expect(pcAt(out.state)).toMatchObject({ x: 1, y: 0 });
    expect(out.outcome.output).not.toHaveProperty("redirected");
    const busy = executeEngineTool(onStrip(1), "move_token", { entity_id: "pc_a", x: 1, y: 0 }, stripCtx([], "host"));
    expect(pcAt(busy.state)).not.toMatchObject({ x: 1, y: 0 });
    expect(busy.outcome.output).toMatchObject({ redirected: true, reason: "another token is there" });
  });
});

describe("party placement and restaging avoid blocking features", () => {
  const crate = MapFeature.parse({ name: "crate", blocks: true, x: 1, y: 4, w: 2, h: 5 });
  const crowded: Location = { ...hall, id: "loc_crowded", features: [door, crate] };
  const both = ctx([hall, crowded]);
  const inCrate = (t: { x: number; y: number }) => t.x >= 1 && t.x <= 2 && t.y >= 4 && t.y <= 8;

  it("a second change_scene re-places existing tokens off blocking cells", () => {
    let s = party(both);
    s = executeEngineTool(s, "change_scene", { location_id: "loc_crowded" }, both).state;
    expect(pcCells(s)).toHaveLength(2);
    for (const t of pcCells(s)) expect(inCrate(t)).toBe(false);
  });

  it("ensureCharacterTokens places new tokens off blocking cells", () => {
    const s = party(both);
    s.locationId = "loc_crowded";
    s.tokens = [];
    ensureCharacterTokens(s, both);
    expect(pcCells(s)).toHaveLength(2);
    for (const t of pcCells(s)) expect(inCrate(t)).toBe(false);
  });

  it("restageForMap keeps the party and monsters off blocking features", () => {
    const crates = MapFeature.parse({ name: "crates", blocks: true, x: 1, y: 1, w: 1, h: 3 });
    const pit = MapFeature.parse({ name: "pit", kind: "focal", blocks: true, x: 8, y: 1, w: 2, h: 3 });
    const loc: Location = { id: "loc_b", name: "B", description: "", mapPrompt: "", mapUrl: "/m.png", fog: false, gridW: 12, gridH: 5, walls: [], features: [crates, pit] };
    const c = ctx([loc]);
    let s = party(c, "loc_b");
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin", count: 2 }, c).state;
    s = restageForMap(s, c);
    for (const t of s.tokens) {
      expect(t.x === 1 && t.y >= 1 && t.y <= 3).toBe(false);
      expect(t.x >= 8 && t.x <= 9 && t.y >= 1 && t.y <= 3).toBe(false);
    }
  });

  it("restaged monsters keep the 3-cell distance from the party and face it", () => {
    const loc: Location = {
      id: "loc_r", name: "Room", description: "", mapPrompt: "", mapUrl: "/m.png", fog: false, gridW: 12, gridH: 6, walls: [],
      features: [MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 2 }), MapFeature.parse({ name: "lair", kind: "focal", x: 3, y: 2 })],
    };
    const c = ctx([loc]);
    let s = emptyGameState("c1");
    s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12 }));
    s = executeEngineTool(s, "change_scene", { location_id: "loc_r" }, c).state;
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin", count: 2 }, c).state;
    const ids = s.monsters.map((m) => m.id);
    s = restageForMap(s, c);
    const pc = pcCells(s)[0];
    const mons = s.tokens.filter((t) => t.entityType === "monster");
    expect(mons.map((m) => m.entityId).sort()).toEqual([...ids].sort());
    for (const m of mons) expect(cheb(m, pc)).toBeGreaterThanOrEqual(MIN_PC_DISTANCE);
    expectDistinct(s.tokens.map((t) => ({ x: t.x, y: t.y })));
  });
});

describe("party next to the anchor feature (no room for a front rank)", () => {
  const altarCentre = { x: 13, y: 5 };
  const g = { gridW: 20, gridH: 12, features: [altar] };
  const nearerAltar = (cells: { x: number; y: number }[], party: { x: number; y: number }) => {
    const c = centroid(cells);
    expect(dist(c, altarCentre)).toBeLessThan(dist(c, party));
  };

  describe("party touching the altar's west side", () => {
    const s = tokensAt([[11, 4], [11, 5]]);
    const party = { x: 11, y: 4.5 };
    it("arc forms on the altar's far side, not split north and south of the party", () => {
      const cells = planSpawn(s, g, 6, { formation: "arc" });
      nearerAltar(cells, party);
      for (const m of cells) expect(m.x).toBeGreaterThan(altar.x); // past the altar's middle, away from the party
    });
    it("line forms on the altar's far side", () => {
      const cells = planSpawn(s, g, 6, { formation: "line" });
      nearerAltar(cells, party);
      for (const m of cells) expect(m.x).toBeGreaterThan(altar.x + altar.w - 1);
    });
    it("cluster (control) already forms around the altar", () => nearerAltar(planSpawn(s, g, 6, {}), party));
  });

  it("party one cell off the footprint (gap 2): the arc stays around the altar", () => {
    nearerAltar(planSpawn(tokensAt([[10, 5], [10, 6]]), g, 6, { formation: "arc" }), { x: 10, y: 5.5 });
  });
});

describe("arc tuning", () => {
  // A 12-monster arc with the party far away: the front rank is at radius max(2, ceil(12/2)) = 6.
  it("extra ranks go behind the front rank, never in front of it (toward the party)", () => {
    const s = tokensAt([[0, 6], [0, 7]]);
    const anchor = { x: 17, y: 6 };
    const cells = planSpawn(s, G(20, 14), 12, { formation: "arc", anchor });
    const radii = cells.map((c) => dist(c, anchor));
    const front = Math.max(2, Math.ceil(12 / 2));
    for (const r of radii) expect(r).toBeGreaterThan(front - 0.75);
  });

  it("with little room in front, the arc fills the party's side before it spills behind the anchor", () => {
    // Party 5 cells away: front radius 2, and cells within 2 of the party are out (x <= 5).
    const s = tokensAt([[3, 2]]);
    const cells = planSpawn(s, G(20, 4), 8, { formation: "arc", anchor: { x: 8 } }); // y from the default (row 2)
    expectDistinct(cells);
    for (const c of cells) expect(c.x).toBeLessThanOrEqual(8);
  });
});

// ---- Phase 1: hidden spawns use line of sight (SP1) ----

describe("planSpawn with walls", () => {
  type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
  const wall: Seg = { id: "w1", x1: 10, y1: 0, x2: 10, y2: 12, kind: "wall", open: false };
  const room: Location = { id: "loc_room", name: "Room", description: "", mapPrompt: "", mapUrl: "/m/r.png", fog: true, gridW: 20, gridH: 12, features: [], walls: [wall] } as unknown as Location;
  const roomGrid = { gridW: 20, gridH: 12, features: [] as MapFeature[], walls: [wall] };

  /** Two PCs (light 6) at x=7, fog on and computed from there. */
  function party7(): GameState {
    const c = ctx([room]);
    let s = emptyGameState("c1");
    s.characters.push(
      Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 6 }),
      Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 8, hp: 8, lightRadius: 6 }),
    );
    s = executeEngineTool(s, "change_scene", { location_id: "loc_room" }, c).state;
    const [a, b] = pcCells(s);
    a!.x = 7;
    a!.y = 5;
    b!.x = 7;
    b!.y = 6;
    return executeEngineTool(s, "set_fog", { mode: "reset" }, c).state;
  }

  it("hidden: monsters may stand just behind a closed wall, inside the party's light radius", () => {
    const s = party7();
    const cells = planSpawn(s, roomGrid, 3, { fog: "hidden", anchor: { x: 11, y: 5 } });
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(c.x).toBeGreaterThanOrEqual(10);
    expect(cells.some((c) => c.x <= 12)).toBe(true); // within 6 of the party at x=7 without the wall
  });

  it("revealed: prefers cells the party can actually see (this side of the wall)", () => {
    const s = party7();
    const cells = planSpawn(s, roomGrid, 3, { fog: "revealed", anchor: { x: 11, y: 5 } });
    for (const c of cells) expect(c.x).toBeLessThan(10);
  });

  it("cells the host hid inside a PC's light radius still count as unseen (review fix)", () => {
    const strip: Location = { id: "loc_f", name: "F", description: "", mapPrompt: "", mapUrl: "/m/f.png", fog: true, gridW: 16, gridH: 10, walls: [], features: [] };
    const c = ctx([strip]);
    let s = emptyGameState("c1");
    s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 4 }));
    s = executeEngineTool(s, "change_scene", { location_id: "loc_f" }, c).state;
    const t = pcCells(s)[0]!;
    t.x = 1;
    t.y = 5;
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, c).state;
    const all: [number, number][] = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) all.push([x, y]);
    s = executeEngineTool(s, "edit_fog", { mode: "hide", cells: all }, c).state;
    expect(planSpawn(s, { gridW: 16, gridH: 10, features: [] }, 3, { anchor: { x: 5, y: 5 }, fog: "hidden" })).toEqual([
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 4 },
    ]);
  });

  it("a SpawnGrid without walls places exactly as with walls: []", () => {
    const s = party();
    const a = planSpawn(s, grid(), 4, { formation: "arc" });
    const b = planSpawn(s, { ...grid(), walls: [] } as Parameters<typeof planSpawn>[1], 4, { formation: "arc" });
    expect(b).toEqual(a);
  });
});
