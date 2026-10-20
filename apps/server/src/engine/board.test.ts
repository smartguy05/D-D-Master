import { describe, expect, it } from "vitest";
import { Character, GameState, MapFeature, effectiveWalls, emptyGameState, hasLineOfSight, type Location } from "@dm/shared";
import { executeEngineTool, resetForRepaint, restageForMap, type EngineContext } from "./tools.js";

const altar = MapFeature.parse({ name: "altar", kind: "focal", lit: true, x: 11, y: 1, w: 5, h: 4 });
const door = MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 6, w: 1, h: 2 });
const nave: Location = { id: "loc_nave", name: "Nave", description: "", mapPrompt: "", mapUrl: "/m/1.png", fog: false, gridW: 22, gridH: 14, walls: [], features: [door, altar] };

function ctx(locations: Location[] = [nave]): EngineContext {
  return { rng: () => 10, monsterTemplate: () => undefined, spell: () => undefined, spellCandidates: () => [], classData: () => undefined, locations };
}

function party(c = ctx()): GameState {
  let s = emptyGameState("c1");
  s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 1 }));
  s = executeEngineTool(s, "change_scene", { location_id: "loc_nave" }, c).state;
  return s;
}

const run = (s: GameState, name: Parameters<typeof executeEngineTool>[1], args: unknown, c = ctx()) => executeEngineTool(s, name, args, c);
const fogOf = (s: GameState) => s.fog[s.locationId!]!;
const tokenOf = (s: GameState, id: string) => s.tokens.find((t) => t.entityId === id)!;

describe("edit_fog", () => {
  it("reveals cells explicitly and hides them again", () => {
    let s = run(party(), "set_fog", { mode: "enable" }).state;
    s = run(s, "edit_fog", { mode: "reveal", cells: [[18, 10], [19, 10]] }).state;
    expect(fogOf(s).revealed).toEqual(expect.arrayContaining(["18,10", "19,10"]));
    s = run(s, "edit_fog", { mode: "hide", cells: [[18, 10]] }).state;
    expect(fogOf(s).revealed).not.toContain("18,10");
    expect(fogOf(s).hidden).toEqual(["18,10"]);
  });

  it("auto-reveal around the party skips hidden cells until revealed explicitly", () => {
    let s = run(party(), "set_fog", { mode: "enable" }).state;
    const t = tokenOf(s, "pc_a");
    const next = `${t.x + 1},${t.y}`;
    expect(fogOf(s).revealed).toContain(next);
    s = run(s, "edit_fog", { mode: "hide", cells: [[t.x + 1, t.y]] }).state;
    expect(fogOf(s).revealed).not.toContain(next);
    // any later tool re-runs the party's light: the hidden cell stays dark
    s = run(s, "move_token", { entity_id: "pc_a", x: t.x, y: t.y + 1 }).state;
    s = run(s, "move_token", { entity_id: "pc_a", x: t.x, y: t.y }).state;
    expect(fogOf(s).revealed).not.toContain(next);
    // the altar's glow (lit feature) does not override a hide either
    s = run(s, "edit_fog", { mode: "hide", cells: [[13, 2]] }).state;
    expect(fogOf(s).revealed).not.toContain("13,2");
    // reveal_area is explicit: un-hides
    s = run(s, "reveal_area", { x: t.x + 1, y: t.y, radius: 0 }).state;
    expect(fogOf(s).revealed).toContain(next);
    expect(fogOf(s).hidden).not.toContain(next);
    // edit_fog reveal un-hides too
    s = run(s, "edit_fog", { mode: "reveal", cells: [[13, 2]] }).state;
    expect(fogOf(s).hidden).toEqual([]);
  });

  it("set_fog reset clears hidden cells too", () => {
    let s = run(party(), "set_fog", { mode: "enable" }).state;
    s = run(s, "edit_fog", { mode: "hide", cells: [[13, 2]] }).state;
    s = run(s, "set_fog", { mode: "reset" }).state;
    expect(fogOf(s).hidden).toEqual([]);
    expect(fogOf(s).revealed).toContain("13,2"); // glow back after reset
  });

  it("ignores cells off the grid and needs a location", () => {
    let s = run(party(), "set_fog", { mode: "enable" }).state;
    s = run(s, "edit_fog", { mode: "reveal", cells: [[99, 1], [-1, 0], [21, 13]] }).state;
    expect(fogOf(s).revealed).toContain("21,13");
    expect(fogOf(s).revealed.some((c) => c.startsWith("99") || c.startsWith("-1"))).toBe(false);
    expect(() => run(emptyGameState("c"), "edit_fog", { mode: "hide", cells: [[1, 1]] })).toThrow(/location/);
  });

  it("duplicate cells count once and huge arrays are rejected", () => {
    let s = run(party(), "set_fog", { mode: "enable" }).state;
    s = run(s, "edit_fog", { mode: "hide", cells: [[20, 12], [20, 12], [20, 12]] }).state;
    expect(fogOf(s).hidden).toEqual(["20,12"]);
    const many = Array.from({ length: 3601 }, () => [1, 1]);
    expect(() => run(s, "edit_fog", { mode: "hide", cells: many })).toThrow();
  });

  it("hidden cells never auto-reveal on change_scene back into the same location", () => {
    let s = run(party(), "set_fog", { mode: "enable" }).state;
    const t = tokenOf(s, "pc_a");
    s = run(s, "edit_fog", { mode: "hide", cells: [[t.x, t.y]] }).state;
    s = run(s, "change_scene", { location_id: "loc_nave" }).state;
    expect(fogOf(s).revealed).not.toContain(`${t.x},${t.y}`);
  });

  it("does not mutate the input state", () => {
    const s = run(party(), "set_fog", { mode: "enable" }).state;
    const before = JSON.stringify(s);
    run(s, "edit_fog", { mode: "hide", cells: [[1, 6]] });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("edit_map_feature", () => {
  it("adds, updates and deletes features as a host edit for the current map", () => {
    let s = party();
    s = run(s, "edit_map_feature", { action: "add", feature: { name: "pews", blocks: true, x: 5, y: 3, w: 3, h: 1 } }).state;
    expect(s.featureEdits.loc_nave).toMatchObject({ mapUrl: "/m/1.png" });
    expect(s.featureEdits.loc_nave!.features.map((f) => f.name)).toEqual(["door", "altar", "pews"]);
    expect(s.featureEdits.loc_nave!.features[2]).toMatchObject({ kind: "feature", lit: false, blocks: true });
    s = run(s, "edit_map_feature", { action: "update", index: 1, feature: { x: 15, y: 9, lit: false } }).state;
    expect(s.featureEdits.loc_nave!.features[1]).toMatchObject({ name: "altar", kind: "focal", x: 15, y: 9, w: 5, h: 4, lit: false });
    s = run(s, "edit_map_feature", { action: "delete", index: 0 }).state;
    expect(s.featureEdits.loc_nave!.features.map((f) => f.name)).toEqual(["altar", "pews"]);
    // the campaign's own (vision) features are untouched
    expect(nave.features).toEqual([door, altar]);
  });

  it("clamps features into the grid", () => {
    const s = run(party(), "edit_map_feature", { action: "add", feature: { name: "big", x: 20, y: 12, w: 9, h: 9 } }).state;
    expect(s.featureEdits.loc_nave!.features.at(-1)).toMatchObject({ x: 20, y: 12, w: 2, h: 2 });
    const t = run(party(), "edit_map_feature", { action: "update", index: 0, feature: { x: 40, y: 40 } }).state;
    expect(t.featureEdits.loc_nave!.features[0]).toMatchObject({ x: 21, y: 13, w: 1, h: 1 });
  });

  it("rejects bad indexes and incomplete features", () => {
    expect(() => run(party(), "edit_map_feature", { action: "update", index: 9, feature: { x: 1 } })).toThrow(/index/);
    expect(() => run(party(), "edit_map_feature", { action: "delete" })).toThrow(/index/);
    expect(() => run(party(), "edit_map_feature", { action: "add", feature: { x: 1, y: 1 } })).toThrow();
  });

  it("expect_name guards update/delete against a stale index", () => {
    const s = party();
    expect(() => run(s, "edit_map_feature", { action: "update", index: 1, expect_name: "door", feature: { x: 3 } })).toThrow(/is "altar", not "door"/);
    expect(() => run(s, "edit_map_feature", { action: "delete", index: 0, expect_name: "altar" })).toThrow(/not "altar"/);
    const ok = run(s, "edit_map_feature", { action: "delete", index: 1, expect_name: "altar" }).state;
    expect(ok.featureEdits.loc_nave!.features.map((f) => f.name)).toEqual(["door"]);
  });

  it("clamps out-of-range sizes and positions before validating", () => {
    const s = run(party(), "edit_map_feature", { action: "update", index: 1, feature: { x: -3, y: 2, w: 0, h: -1 } }).state;
    expect(s.featureEdits.loc_nave!.features[1]).toMatchObject({ x: 0, y: 2, w: 1, h: 1 });
    const t = run(party(), "edit_map_feature", { action: "add", feature: { name: "p", x: 2.6, y: 1, w: 0 } }).state;
    expect(t.featureEdits.loc_nave!.features.at(-1)).toMatchObject({ x: 3, y: 1, w: 1, h: 1 });
  });

  it("rejects a non-finite size instead of silently turning it into 1 (JSON.parse('1e400') is Infinity)", () => {
    const body = JSON.parse('{"action":"update","index":1,"feature":{"w":1e400}}');
    expect(body.feature.w).toBe(Infinity);
    expect(() => run(party(), "edit_map_feature", body)).toThrow();
    for (const k of ["x", "y", "h"]) {
      for (const v of ["1e400", "-1e400"]) {
        const b = JSON.parse(`{"action":"update","index":1,"feature":{"${k}":${v}}}`);
        expect(() => run(party(), "edit_map_feature", b)).toThrow();
        expect(() => run(party(), "edit_map_feature", { action: "add", feature: { name: "p", x: 1, y: 1, [k]: Number(v) } })).toThrow();
      }
    }
  });

  it("reset drops the host edit", () => {
    let s = run(party(), "edit_map_feature", { action: "delete", index: 1 }).state;
    s = run(s, "edit_map_feature", { action: "reset" }).state;
    expect(s.featureEdits.loc_nave).toBeUndefined();
  });

  it("edited features drive spawns, entry and lit-feature fog", () => {
    let s = run(party(), "edit_map_feature", { action: "update", index: 1, feature: { x: 16, y: 9, w: 1, h: 1 } }).state;
    s = run(s, "spawn_monster", { name: "Goblin" }).state;
    expect(s.tokens.find((t) => t.entityType === "monster")).toMatchObject({ x: 16, y: 9 });
    s = run(s, "set_fog", { mode: "enable" }).state;
    expect(fogOf(s).revealed).toContain("16,9");
    expect(fogOf(s).revealed).not.toContain("13,2"); // old altar spot is dark now
    s = run(s, "edit_map_feature", { action: "update", index: 0, feature: { x: 3, y: 12 } }).state;
    s = run(s, "change_scene", { location_id: "loc_nave" }).state;
    expect(tokenOf(s, "pc_a")).toMatchObject({ x: 3, y: 12 });
  });

  it("a repaint (new mapUrl) makes the host's edit stop applying", () => {
    let s = run(party(), "edit_map_feature", { action: "update", index: 1, feature: { x: 16, y: 9, w: 1, h: 1 } }).state;
    s = run(s, "spawn_monster", { name: "Goblin" }).state;
    s = run(s, "set_fog", { mode: "enable" }).state;
    s = run(s, "edit_fog", { mode: "hide", cells: [[1, 6]] }).state;
    const repainted: Location = { ...nave, mapUrl: "/m/2.png", features: [door, altar] };
    const next = restageForMap(s, ctx([repainted]));
    const mon = next.tokens.find((t) => t.entityType === "monster")!;
    expect(Math.max(Math.abs(mon.x - 13), Math.abs(mon.y - 2))).toBeLessThanOrEqual(1); // back at the read altar
    expect(fogOf(next).hidden).toEqual([]); // new picture, fresh fog
  });

  it("needs a current location", () => {
    expect(() => run(emptyGameState("c"), "edit_map_feature", { action: "add", feature: { name: "x", x: 0, y: 0 } })).toThrow(/location/);
  });
});

describe("set_monster_hidden", () => {
  it("hides and shows a monster; characters are rejected", () => {
    let s = run(party(), "spawn_monster", { name: "Goblin" }).state;
    const id = s.monsters[0]!.id;
    s = run(s, "set_monster_hidden", { monster_id: id, hidden: true }).state;
    expect(s.monsters[0]!.hidden).toBe(true);
    s = run(s, "set_monster_hidden", { monster_id: "Goblin", hidden: false }).state;
    expect(s.monsters[0]!.hidden).toBe(false);
    expect(() => run(s, "set_monster_hidden", { monster_id: "pc_a", hidden: true })).toThrow(/monster/i);
  });

  it("an ambusher hidden before start_combat still gets an initiative slot and its turn is named to the DM", () => {
    let s = run(party(), "spawn_monster", { name: "Goblin" }).state;
    const id = s.monsters[0]!.id;
    s = run(s, "set_monster_hidden", { monster_id: id, hidden: true }).state;
    const started = run(s, "start_combat", {});
    s = started.state;
    expect(s.combat.order.map((o) => o.entityId)).toContain(id);
    expect((started.outcome.output as { order: string[] }).order.join(" ")).toContain("Goblin");
    let sawGoblin = false;
    for (let i = 0; i < 2; i++) {
      const r = run(s, "next_turn", {});
      s = r.state;
      if ((r.outcome.output as { id: string }).id === id) sawGoblin = true;
    }
    expect(sawGoblin || s.combat.order[0]!.entityId === id).toBe(true);
  });

  it("get_party_status tells the DM which monsters it hid from the table", () => {
    let s = run(party(), "spawn_monster", { name: "Goblin" }).state;
    s = run(s, "set_monster_hidden", { monster_id: s.monsters[0]!.id, hidden: true }).state;
    const status = run(s, "get_party_status", {}).outcome.output as { monsters: Record<string, unknown>[] };
    expect(status.monsters[0]).toMatchObject({ hidden: true });
    s = run(s, "set_monster_hidden", { monster_id: s.monsters[0]!.id, hidden: false }).state;
    const shown = run(s, "get_party_status", {}).outcome.output as { monsters: Record<string, unknown>[] };
    expect(shown.monsters[0]!.hidden).toBeUndefined();
  });

  it("board tools do not mutate the input state", () => {
    const s = run(party(), "spawn_monster", { name: "Goblin" }).state;
    const before = JSON.stringify(s);
    run(s, "set_monster_hidden", { monster_id: s.monsters[0]!.id, hidden: true });
    run(s, "edit_map_feature", { action: "update", index: 0, feature: { x: 4 } });
    run(s, "edit_map_feature", { action: "reset" });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("resetForRepaint", () => {
  it("drops the host's feature edit and the location's explored + hidden fog, then re-lights the party", () => {
    let s = run(party(), "set_fog", { mode: "enable" }).state;
    s = run(s, "edit_map_feature", { action: "delete", index: 1 }).state;
    s = run(s, "edit_fog", { mode: "hide", cells: [[5, 5]] }).state;
    s = run(s, "reveal_area", { x: 18, y: 10, radius: 0 }).state;
    const next = resetForRepaint(s, ctx(), "loc_nave");
    expect(next.featureEdits.loc_nave).toBeUndefined();
    expect(fogOf(next).hidden).toEqual([]);
    expect(fogOf(next).revealed).not.toContain("18,10");
    const t = tokenOf(next, "pc_a");
    expect(fogOf(next).revealed).toContain(`${t.x},${t.y}`); // party light is back
    expect(next.version).toBe(s.version + 1);
    expect(s.featureEdits.loc_nave).toBeDefined(); // input untouched
  });

  it("works for a location the party is not in", () => {
    const s = GameState.parse({ campaignId: "c", fog: { loc_x: { enabled: true, revealed: ["1,1"], hidden: ["2,2"] } }, featureEdits: { loc_x: { features: [] } } });
    const next = resetForRepaint(s, ctx(), "loc_x");
    expect(next.fog.loc_x).toMatchObject({ revealed: [], hidden: [] });
    expect(next.featureEdits).toEqual({});
  });
});

// ---- Phase 1: host wall editor (T2) and walls surviving a repaint (S3) ----

type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
const wseg = (id: string, x1: number, y1: number, x2: number, y2: number, kind: Seg["kind"] = "wall", open = false): Seg => ({ id, x1, y1, x2, y2, kind, open });
const detected = [wseg("w1", 6, 0, 6, 5), wseg("d1", 6, 5, 6, 6, "door"), wseg("w2", 6, 6, 6, 14)];
const walledNave = { ...nave, walls: detected } as unknown as Location;
const wctx = () => ctx([walledNave]);
const wallEditOf = (s: GameState) => (s as unknown as { wallEdits: Record<string, { walls: Seg[] } | undefined> }).wallEdits?.loc_nave;
const norm = (w: Pick<Seg, "x1" | "y1" | "x2" | "y2">) => [Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2)];

describe("edit_walls (host wall editor)", () => {
  it("add: stores the location's walls plus the new segment with a fresh unique id", () => {
    const s = run(party(wctx()), "edit_walls", { action: "add", segment: { x1: 2, y1: 3, x2: 5, y2: 3, kind: "door" } }, wctx()).state;
    const walls = wallEditOf(s)!.walls;
    expect(walls).toHaveLength(4);
    const added = walls.find((w) => !detected.some((d) => d.id === w.id))!;
    expect(added).toBeDefined();
    expect(norm(added)).toEqual([2, 3, 5, 3]);
    expect(added).toMatchObject({ kind: "door", open: false });
    expect(new Set(walls.map((w) => w.id)).size).toBe(walls.length);
    // a second add gets yet another id
    const s2 = run(s, "edit_walls", { action: "add", segment: { x1: 0, y1: 1, x2: 0, y2: 2, kind: "wall" } }, wctx()).state;
    const ids = wallEditOf(s2)!.walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("add: rejects diagonal and zero-length segments", () => {
    const s = party(wctx());
    expect(() => run(s, "edit_walls", { action: "add", segment: { x1: 1, y1: 1, x2: 3, y2: 3, kind: "wall" } }, wctx())).toThrow();
    expect(() => run(s, "edit_walls", { action: "add", segment: { x1: 2, y1: 2, x2: 2, y2: 2, kind: "wall" } }, wctx())).toThrow();
  });

  it("add: a segment past the board edge is refused or clamped onto the grid", () => {
    const s = party(wctx());
    let out: GameState | undefined;
    try {
      out = run(s, "edit_walls", { action: "add", segment: { x1: 20, y1: 2, x2: 30, y2: 2, kind: "wall" } }, wctx()).state;
    } catch {
      out = undefined;
    }
    if (out) for (const w of wallEditOf(out)!.walls) {
      expect(Math.max(w.x1, w.x2)).toBeLessThanOrEqual(nave.gridW);
      expect(Math.max(w.y1, w.y2)).toBeLessThanOrEqual(nave.gridH);
    }
  });

  it("delete: removes a segment by id; an unknown id throws", () => {
    const s = run(party(wctx()), "edit_walls", { action: "delete", id: "w1" }, wctx()).state;
    expect(wallEditOf(s)!.walls.map((w) => w.id)).toEqual(["d1", "w2"]);
    expect(() => run(s, "edit_walls", { action: "delete", id: "nope" }, wctx())).toThrow();
    expect(() => run(s, "edit_walls", { action: "delete" }, wctx())).toThrow();
  });

  it("toggle: opens and closes a door; a wall can't be toggled", () => {
    let s = run(party(wctx()), "edit_walls", { action: "toggle", id: "d1" }, wctx()).state;
    expect(wallEditOf(s)!.walls.find((w) => w.id === "d1")!.open).toBe(true);
    s = run(s, "edit_walls", { action: "toggle", id: "d1" }, wctx()).state;
    expect(wallEditOf(s)!.walls.find((w) => w.id === "d1")!.open).toBe(false);
    expect(() => run(s, "edit_walls", { action: "toggle", id: "w1" }, wctx())).toThrow();
  });

  it("reset: drops the host's wall edit for the location", () => {
    let s = run(party(wctx()), "edit_walls", { action: "delete", id: "w1" }, wctx()).state;
    expect(wallEditOf(s)).toBeDefined();
    s = run(s, "edit_walls", { action: "reset" }, wctx()).state;
    expect(wallEditOf(s)).toBeUndefined();
  });

  it("toggling a door open with fog on reveals what is behind it", () => {
    const c = wctx();
    let s = party(c);
    const t = tokenOf(s, "pc_a");
    t.x = 4;
    t.y = 5;
    (s.characters[0] as { lightRadius?: number }).lightRadius = 6;
    s = run(s, "set_fog", { mode: "reset" }, c).state;
    s = run(s, "set_fog", { mode: "enable" }, c).state;
    expect(fogOf(s).revealed).not.toContain("8,5");
    s = run(s, "edit_walls", { action: "toggle", id: "d1" }, c).state;
    expect(fogOf(s).revealed).toContain("8,5");
  });

  it("does not mutate the input state", () => {
    const s = party(wctx());
    const before = JSON.stringify(s);
    run(s, "edit_walls", { action: "add", segment: { x1: 2, y1: 3, x2: 5, y2: 3, kind: "wall" } }, wctx());
    run(s, "edit_walls", { action: "toggle", id: "d1" }, wctx());
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("resetForRepaint keeps host wall edits (S3)", () => {
  it("drops featureEdits but keeps wallEdits for the repainted location", () => {
    let s = run(party(wctx()), "edit_map_feature", { action: "delete", index: 1 }, wctx()).state;
    s = run(s, "edit_walls", { action: "toggle", id: "d1" }, wctx()).state;
    const next = resetForRepaint(s, wctx(), "loc_nave");
    expect(next.featureEdits.loc_nave).toBeUndefined();
    expect(wallEditOf(next)!.walls.find((w) => w.id === "d1")!.open).toBe(true);
    // the walls in effect after a repaint of the same location are still the host's
    const repainted = { ...walledNave, mapUrl: "/m/2.png", walls: [wseg("w1", 1, 0, 1, 3)] } as unknown as Location;
    expect(effectiveWalls(next, repainted).find((w) => w.id === "d1")!.open).toBe(true);
  });
});

// ---- Phase 1 review fixes ----

describe("edit_walls add of a door or window over a wall run (review fix)", () => {
  const solid = { ...nave, walls: [wseg("w1", 4, 0, 4, 10)] } as unknown as Location;
  const sctx = () => ctx([solid]);

  it("cuts the wall under a new door, so opening the door lets sight through", () => {
    let s = run(party(sctx()), "edit_walls", { action: "add", segment: { x1: 4, y1: 2, x2: 4, y2: 3, kind: "door" } }, sctx()).state;
    const walls = wallEditOf(s)!.walls;
    const door = walls.find((w) => w.kind === "door")!;
    expect(norm(door)).toEqual([4, 2, 4, 3]);
    expect(walls.filter((w) => w.kind === "wall").map(norm).sort()).toEqual([
      [4, 0, 4, 2],
      [4, 3, 4, 10],
    ]);
    expect(new Set(walls.map((w) => w.id)).size).toBe(walls.length);
    s = run(s, "set_door", { door_id: door.id, open: true }, sctx()).state;
    expect(hasLineOfSight({ x: 3, y: 2 }, { x: 4, y: 2 }, effectiveWalls(s, solid))).toBe(true);
  });

  it("a window over a wall replaces that stretch too; a wall added over a door leaves the door alone", () => {
    let s = run(party(sctx()), "edit_walls", { action: "add", segment: { x1: 4, y1: 5, x2: 4, y2: 7, kind: "window" } }, sctx()).state;
    let walls = wallEditOf(s)!.walls;
    expect(walls.filter((w) => w.kind === "wall").map(norm).sort()).toEqual([
      [4, 0, 4, 5],
      [4, 7, 4, 10],
    ]);
    s = run(party(wctx()), "edit_walls", { action: "add", segment: { x1: 6, y1: 4, x2: 6, y2: 7, kind: "wall" } }, wctx()).state;
    walls = wallEditOf(s)!.walls;
    expect(walls.find((w) => w.id === "d1")).toMatchObject({ x1: 6, y1: 5, x2: 6, y2: 6, kind: "door" });
  });
});

describe("edit_walls add outside the grid (review fix)", () => {
  it("refuses a segment that lies entirely outside the grid instead of clamping it onto the border", () => {
    const s = party(wctx());
    expect(() => run(s, "edit_walls", { action: "add", segment: { x1: 30, y1: 1, x2: 30, y2: 5, kind: "wall" } }, wctx())).toThrow(/outside/);
    expect(() => run(s, "edit_walls", { action: "add", segment: { x1: -3, y1: 1, x2: -3, y2: 5, kind: "wall" } }, wctx())).toThrow(/outside/);
    expect(() => run(s, "edit_walls", { action: "add", segment: { x1: 30, y1: 2, x2: 40, y2: 2, kind: "wall" } }, wctx())).toThrow(/outside/);
  });
});

describe("a DM door toggle does not pin the walls across a repaint (review fix)", () => {
  it("resetForRepaint drops a wall edit made only by set_door, but keeps one the host made", () => {
    let s = run(party(wctx()), "set_door", { door_id: "d1", open: true }, wctx()).state;
    expect(wallEditOf(s)!.walls.find((w) => w.id === "d1")!.open).toBe(true);
    expect(wallEditOf(resetForRepaint(s, wctx(), "loc_nave"))).toBeUndefined();
    // the host edits after the DM's toggle: now it is a host fix and survives
    s = run(s, "edit_walls", { action: "delete", id: "w1" }, wctx()).state;
    s = run(s, "set_door", { door_id: "d1", open: false }, wctx()).state;
    expect(wallEditOf(resetForRepaint(s, wctx(), "loc_nave"))!.walls.map((w) => w.id)).toEqual(["d1", "w2"]);
  });
});

describe("move_token redirect respects walls (review fix)", () => {
  it("an occupied destination redirects to a free cell on the mover's side of a wall", () => {
    const c = ctx([{ ...nave, walls: [wseg("w1", 4, 0, 4, 14)] } as unknown as Location]);
    let s = party(c);
    s.characters.push(Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 8, hp: 8 }));
    s = executeEngineTool(s, "change_scene", { location_id: "loc_nave" }, c).state;
    const thorin = tokenOf(s, "pc_a");
    const lyra = tokenOf(s, "pc_b");
    [thorin.x, thorin.y, lyra.x, lyra.y] = [1, 2, 3, 0];
    s.tokens.push({ id: "tok_gob", entityId: "m_gob", entityType: "monster", x: 2, y: 0, size: 1 } as GameState["tokens"][number]);
    const out = run(s, "move_token", { entity_id: "pc_a", x: 3, y: 0 }, c).outcome.output as { error?: string; pos?: number[] };
    expect(out.error).toBeUndefined();
    expect(out.pos![0]).toBeLessThan(4);
  });
});
