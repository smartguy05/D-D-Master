import { describe, expect, it } from "vitest";
import { Character, GameState, Location, emptyGameState, type Rng } from "@dm/shared";
import { executeEngineTool, type EngineContext } from "./tools.js";

const fixed: Rng = () => 20;

function ctx(rng: Rng = () => 10): EngineContext {
  return {
    rng,
    monsterTemplate: () => undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [
      { id: "loc_hall", name: "Hall", description: "", mapPrompt: "", fog: false, features: [], gridW: 30, gridH: 12 },
      { id: "loc_cave", name: "Cave", description: "", mapPrompt: "", fog: false, features: [], gridW: 20, gridH: 10 },
      { id: "loc_crypt", name: "Crypt", description: "", mapPrompt: "", fog: true, features: [], gridW: 20, gridH: 10 },
    ],
  };
}

function party(): GameState {
  let s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12 }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 8, hp: 8, lightRadius: 2 }),
  );
  s = executeEngineTool(s, "change_scene", { location_id: "loc_hall" }, ctx()).state;
  return s;
}

const revealed = (s: GameState) => new Set(s.fog[s.locationId!]?.revealed ?? []);

describe("fog of war", () => {
  it("is off by default and old saves without fog still parse", () => {
    const s = party();
    expect(s.fog).toEqual({});
    const legacy = GameState.parse({ campaignId: "old", characters: [] });
    expect(legacy.fog).toEqual({});
  });

  it("enabling fog reveals a light-radius circle around every character", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    const r = revealed(s);
    const thorin = s.tokens.find((t) => t.entityId === "pc_a")!;
    expect(s.fog.loc_hall.enabled).toBe(true);
    expect(r.has(`${thorin.x},${thorin.y}`)).toBe(true);
    // default radius 6 reaches 6 cells to the right on the same row, but not 7
    expect(r.has(`${thorin.x + 6},${thorin.y}`)).toBe(true);
    expect(r.has(`${thorin.x + 8},${thorin.y}`)).toBe(false);
    // corners of the square are outside the circle
    expect(r.has(`${thorin.x + 6},${thorin.y + 6}`)).toBe(false);
    expect(r.has("29,0")).toBe(false);
  });

  it("moving a character reveals around its new cell", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    expect(revealed(s).has("25,5")).toBe(false);
    s = executeEngineTool(s, "move_token", { entity_id: "pc_b", x: 25, y: 5 }, ctx()).state;
    const r = revealed(s);
    expect(r.has("25,5")).toBe(true);
    expect(r.has("27,5")).toBe(true); // Lyra's light radius is 2
    expect(r.has("28,5")).toBe(false);
  });

  it("reveal_area reveals circles and rectangles, clipped to the grid", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    const before = revealed(s).size;
    const out = executeEngineTool(s, "reveal_area", { x: 28, y: 0, w: 5, h: 2 }, ctx());
    s = out.state;
    expect((out.outcome.output as { revealed: number }).revealed).toBe(4); // cols 28-29, rows 0-1
    expect(revealed(s).has("29,1")).toBe(true);
    s = executeEngineTool(s, "reveal_area", { x: 20, y: 11, radius: 1 }, ctx()).state;
    expect(revealed(s).size).toBe(before + 4 + 6); // 3×3 around (20,11), clipped at the bottom edge
  });

  it("reset forgets explored cells but keeps the party's light; disable shows everything", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    s = executeEngineTool(s, "reveal_area", { x: 25, y: 5, radius: 3 }, ctx()).state;
    expect(revealed(s).has("25,5")).toBe(true);
    s = executeEngineTool(s, "set_fog", { mode: "reset" }, ctx()).state;
    expect(revealed(s).has("25,5")).toBe(false);
    expect(revealed(s).size).toBeGreaterThan(0);
    s = executeEngineTool(s, "set_fog", { mode: "disable" }, ctx()).state;
    expect(s.fog.loc_hall.enabled).toBe(false);
  });

  it("fog is per location and a scene change reveals around the party on the new map", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    s = executeEngineTool(s, "change_scene", { location_id: "loc_cave" }, ctx()).state;
    expect(s.fog.loc_cave).toBeUndefined(); // fog off in the cave until enabled
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    expect(revealed(s).size).toBeGreaterThan(0);
    s = executeEngineTool(s, "change_scene", { location_id: "loc_hall" }, ctx()).state;
    expect(s.fog.loc_hall.enabled).toBe(true);
    expect(s.fog.loc_hall.revealed.length).toBeGreaterThan(0);
  });

  it("locations default to fog on; old outlines without the flag get it", () => {
    expect(Location.parse({ id: "loc_x", name: "X" }).fog).toBe(true);
  });

  it("first arrival at a fog location turns fog on and reveals the party's light", () => {
    let s = party();
    const out = executeEngineTool(s, "change_scene", { location_id: "loc_crypt" }, ctx());
    s = out.state;
    expect(s.fog.loc_crypt.enabled).toBe(true);
    expect((out.outcome.output as { fog: boolean }).fog).toBe(true);
    const thorin = s.tokens.find((t) => t.entityId === "pc_a")!;
    expect(revealed(s).has(`${thorin.x},${thorin.y}`)).toBe(true);
  });

  it("a location without fog stays clear, and a revisit keeps a set_fog override", () => {
    let s = party();
    expect((executeEngineTool(s, "change_scene", { location_id: "loc_cave" }, ctx()).outcome.output as { fog: boolean }).fog).toBe(false);
    s = executeEngineTool(s, "change_scene", { location_id: "loc_crypt" }, ctx()).state;
    s = executeEngineTool(s, "set_fog", { mode: "disable" }, ctx()).state;
    s = executeEngineTool(s, "change_scene", { location_id: "loc_hall" }, ctx()).state;
    s = executeEngineTool(s, "change_scene", { location_id: "loc_crypt" }, ctx()).state;
    expect(s.fog.loc_crypt.enabled).toBe(false);
  });

  it("does not reveal when fog is disabled", () => {
    let s = party();
    s = executeEngineTool(s, "move_token", { entity_id: "pc_a", x: 20, y: 5 }, ctx()).state;
    expect(s.fog).toEqual({});
  });

  it("party status marks monsters standing in the fog as unseen", () => {
    let s = party();
    s = executeEngineTool(s, "set_fog", { mode: "enable" }, ctx()).state;
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin", x: 28, y: 1 }, ctx()).state;
    s = executeEngineTool(s, "spawn_monster", { name: "Rat", x: 2, y: 6 }, ctx()).state;
    const st = executeEngineTool(s, "get_party_status", {}, ctx()).outcome.output as {
      monsters: { name: string; unseen?: boolean }[];
      fog: { enabled: boolean } | null;
    };
    expect(st.fog?.enabled).toBe(true);
    expect(st.monsters.find((m) => m.name === "Goblin")?.unseen).toBe(true);
    expect(st.monsters.find((m) => m.name === "Rat")?.unseen).toBeUndefined();
  });
});

describe("board effects", () => {
  it("damage and healing emit hit/heal effects on the target", () => {
    const s = party();
    const dmg = executeEngineTool(s, "apply_damage", { target_id: "Thorin", amount: 3, damage_type: "Fire" }, ctx());
    expect(dmg.outcome.effects).toEqual([expect.objectContaining({ kind: "hit", targetId: "pc_a", element: "fire" })]);
    const zero = executeEngineTool(s, "apply_damage", { target_id: "Thorin", amount: 0 }, ctx());
    expect(zero.outcome.effects).toEqual([]);
    const heal = executeEngineTool(dmg.state, "heal", { target_id: "pc_a", amount: 2 }, ctx());
    expect(heal.outcome.effects).toEqual([expect.objectContaining({ kind: "heal", targetId: "pc_a" })]);
  });

  it("a natural 20 emits a crit effect on the roller; secret rolls emit nothing", () => {
    const s = party();
    const crit = executeEngineTool(s, "request_player_roll", { character_id: "pc_a", notation: "1d20+5", label: "Axe attack" }, ctx(fixed));
    expect(crit.outcome.effects).toEqual([expect.objectContaining({ kind: "crit", targetId: "pc_a" })]);
    const fumble = executeEngineTool(s, "roll_dice", { notation: "1d20", label: "x", roller_id: "pc_a" }, ctx(() => 1));
    expect(fumble.outcome.effects.map((e) => e.kind)).toEqual(["miss"]);
    const secret = executeEngineTool(s, "roll_dice", { notation: "1d20", label: "x", roller_id: "pc_a", secret: true }, ctx(fixed));
    expect(secret.outcome.effects).toEqual([]);
    const plain = executeEngineTool(s, "roll_dice", { notation: "1d20", label: "x", roller_id: "pc_a" }, ctx());
    expect(plain.outcome.effects).toEqual([]);
  });

  it("play_effect resolves names and needs a target or a cell", () => {
    const s = party();
    const out = executeEngineTool(s, "play_effect", { kind: "lightning", target_id: "Thorin", source_id: "Lyra" }, ctx());
    expect(out.outcome.effects[0]).toMatchObject({ kind: "lightning", targetId: "pc_a", sourceId: "pc_b" });
    expect(out.outcome.effects[0].id).toMatch(/^fx/);
    const area = executeEngineTool(s, "play_effect", { kind: "fireball", x: 10, y: 4, radius: 4 }, ctx());
    expect(area.outcome.effects[0]).toMatchObject({ kind: "fireball", x: 10, y: 4, radius: 4 });
    expect(() => executeEngineTool(s, "play_effect", { kind: "fireball" }, ctx())).toThrow(/target_id or x and y/);
    expect(() => executeEngineTool(s, "play_effect", { kind: "banana", x: 1, y: 1 }, ctx())).toThrow();
  });
});
