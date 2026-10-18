import { describe, expect, it } from "vitest";
import { Character, MapFeature, emptyGameState, type GameState, type Location } from "@dm/shared";
import { executeEngineTool, restageForMap, type EngineContext } from "./tools.js";

const nave: Location = {
  id: "loc_nave",
  name: "Nave",
  description: "",
  mapPrompt: "",
  gridW: 22,
  gridH: 14,
  features: [
    MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 6, w: 1, h: 2 }),
    MapFeature.parse({ name: "altar", kind: "focal", lit: true, x: 11, y: 1, w: 5, h: 4 }),
  ],
};

function ctx(locations: Location[] = [nave]): EngineContext {
  return { rng: () => 10, monsterTemplate: () => undefined, spell: () => undefined, spellCandidates: () => [], classData: () => undefined, locations };
}

function party(c = ctx()): GameState {
  let s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 1 }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 8, hp: 8, lightRadius: 1 }),
  );
  s = executeEngineTool(s, "change_scene", { location_id: "loc_nave" }, c).state;
  return s;
}

const tokenOf = (s: GameState, id: string) => s.tokens.find((t) => t.entityId === id)!;
const revealed = (s: GameState) => new Set(s.fog[s.locationId!]?.revealed ?? []);

describe("map features in the engine", () => {
  it("places the party at the entrance", () => {
    const s = party();
    const a = tokenOf(s, "pc_a");
    expect(a).toMatchObject({ x: 1, y: 6 });
    const b = tokenOf(s, "pc_b");
    expect(Math.max(Math.abs(b.x - 1), Math.abs(b.y - 6))).toBe(1);
  });

  it("spawns monsters at the focal feature unless x/y are given", () => {
    let s = party();
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin", count: 2 }, ctx()).state;
    const mons = s.tokens.filter((t) => t.entityType === "monster");
    expect(mons[0]).toMatchObject({ x: 13, y: 2 });
    s = executeEngineTool(s, "spawn_monster", { name: "Rat", x: 3, y: 3 }, ctx()).state;
    expect(s.tokens.at(-1)).toMatchObject({ x: 3, y: 3 });
  });

  it("lit features glow through fog", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    const r = revealed(s);
    expect(r.has("13,2")).toBe(true); // altar
    expect(r.has("9,1")).toBe(true); // altar glow (radius 2)
    expect(r.has("19,10")).toBe(false); // dark far corner
  });

  it("falls back to left-edge entry and right-side spawns without features", () => {
    const bare: Location = { ...nave, features: [] };
    let s = party(ctx([bare]));
    expect(tokenOf(s, "pc_a")).toMatchObject({ x: 1, y: 7 });
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin" }, ctx([bare])).state;
    expect(s.tokens.at(-1)).toMatchObject({ x: 19, y: 7 });
  });

  it("restages the current scene after a repaint: party to entrance, monsters to focal, fog redrawn", () => {
    const old: Location = { ...nave, features: [] };
    let s = party(ctx([old]));
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin", count: 3 }, ctx([old])).state;
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx([old])).state;
    s = executeEngineTool(s, "reveal_area", { x: 17, y: 5, w: 3, h: 4 }, ctx([old])).state;
    s = executeEngineTool(s, "move_token", { entity_id: "pc_a", x: 8, y: 10 }, ctx([old])).state;

    const next = restageForMap(s, ctx());
    expect(next).not.toBe(s);
    expect(tokenOf(next, "pc_a")).toMatchObject({ x: 1, y: 6 });
    const mons = next.tokens.filter((t) => t.entityType === "monster");
    expect(mons).toHaveLength(3);
    for (const m of mons) expect(Math.max(Math.abs(m.x - 13), Math.abs(m.y - 2))).toBeLessThanOrEqual(1);
    const r = revealed(next);
    expect(r.has("18,6")).toBe(false); // the old hard-coded reveal is gone
    expect(r.has("13,2")).toBe(true); // the altar's glow is visible
    expect(next.version).toBe(s.version + 1);
    // input untouched
    expect(tokenOf(s, "pc_a")).toMatchObject({ x: 8, y: 10 });
  });

  it("does not restage during combat", () => {
    let s = party(ctx([{ ...nave, features: [] }]));
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin" }, ctx()).state;
    s = executeEngineTool(s, "start_combat", {}, ctx()).state;
    expect(restageForMap(s, ctx())).toBe(s);
  });
});
