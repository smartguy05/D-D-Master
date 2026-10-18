import { describe, expect, it } from "vitest";
import { Character, GameState, MapFeature, emptyGameState, type Location } from "@dm/shared";
import { executeEngineTool, restageForMap, type EngineContext } from "./tools.js";

const altar = MapFeature.parse({ name: "altar", kind: "focal", lit: true, x: 11, y: 1, w: 5, h: 4 });
const door = MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 6, w: 1, h: 2 });
const nave: Location = { id: "loc_nave", name: "Nave", description: "", mapPrompt: "", mapUrl: "/m/1.png", gridW: 22, gridH: 14, features: [door, altar] };

function ctx(locations: Location[] = [nave]): EngineContext {
  return { rng: () => 10, monsterTemplate: () => undefined, locations };
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
});
