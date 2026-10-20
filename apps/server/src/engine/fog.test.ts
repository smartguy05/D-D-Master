import { describe, expect, it } from "vitest";
import { Character, GameState, Location, cellsInRadius, emptyGameState, type Rng } from "@dm/shared";
import { executeEngineTool, type EngineContext } from "./tools.js";
import { revealAroundCharacters } from "./fog.js";

const fixed: Rng = () => 20;

function ctx(rng: Rng = () => 10): EngineContext {
  return {
    rng,
    monsterTemplate: () => undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [
      { id: "loc_hall", name: "Hall", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 30, gridH: 12 },
      { id: "loc_cave", name: "Cave", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 20, gridH: 10 },
      { id: "loc_crypt", name: "Crypt", description: "", mapPrompt: "", fog: true, walls: [], features: [], gridW: 20, gridH: 10 },
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

// ---- Phase 1: walls block light (F1, F3, T1 fog) ----

type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
const wseg = (id: string, x1: number, y1: number, x2: number, y2: number, kind: Seg["kind"] = "wall", open = false): Seg => ({ id, x1, y1, x2, y2, kind, open });
/** A wall on x=4 from top to bottom, with a closed door d1 on the edge y 2..3. */
const vaultWalls = (doorOpen = false) => [wseg("w1", 4, 0, 4, 2), wseg("d1", 4, 2, 4, 3, "door", doorOpen), wseg("w2", 4, 3, 4, 10)];

function wallCtx(walls: Seg[] = vaultWalls()): EngineContext {
  const c = ctx();
  const vault = { id: "loc_vault", name: "Vault", description: "", mapPrompt: "", fog: true, features: [], gridW: 12, gridH: 10, walls } as unknown as Location;
  return { ...c, locations: [...c.locations, vault] };
}

/** One PC (light 6) at (2,2) in the fogged vault, fog re-computed from there. */
function inVault(c = wallCtx()): GameState {
  let s = emptyGameState("c1");
  s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 6 }));
  s = executeEngineTool(s, "change_scene", { location_id: "loc_vault" }, c).state;
  const t = s.tokens.find((x) => x.entityId === "pc_a")!;
  t.x = 2;
  t.y = 2;
  return executeEngineTool(s, "set_fog", { mode: "reset" }, c).state;
}

describe("fog of war with walls", () => {
  it("revealAroundCharacters takes grid.walls: a closed wall on x=4 leaves every cell x>=4 dark", () => {
    const s = GameState.parse({
      campaignId: "c",
      locationId: "loc_vault",
      characters: [Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 6 })],
      tokens: [{ id: "t1", entityId: "pc_a", entityType: "character", x: 2, y: 2 }],
      fog: { loc_vault: { enabled: true, revealed: [] } },
    });
    revealAroundCharacters(s, { gridW: 12, gridH: 10, features: [], walls: [wseg("w", 4, 0, 4, 10)] } as Parameters<typeof revealAroundCharacters>[1]);
    const r = revealed(s);
    expect(r.has("2,2")).toBe(true);
    expect(r.has("3,2")).toBe(true);
    for (const k of r) expect(Number(k.split(",")[0])).toBeLessThan(4);
  });

  it("with no walls the revealed cells are the light radius, as before", () => {
    const s = GameState.parse({
      campaignId: "c",
      locationId: "loc_vault",
      characters: [Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, lightRadius: 6 })],
      tokens: [{ id: "t1", entityId: "pc_a", entityType: "character", x: 2, y: 2 }],
      fog: { loc_vault: { enabled: true, revealed: [] } },
    });
    revealAroundCharacters(s, { gridW: 12, gridH: 10, features: [], walls: [] } as Parameters<typeof revealAroundCharacters>[1]);
    expect(revealed(s)).toEqual(new Set(cellsInRadius(2, 2, 6, 12, 10)));
  });

  it("the engine reads the current location's walls (currentGrid): nothing past the closed door is revealed", () => {
    const s = inVault();
    const r = revealed(s);
    expect(r.has("3,2")).toBe(true);
    for (const k of r) expect(Number(k.split(",")[0])).toBeLessThan(4);
  });

  it("the host's wall edit (state.wallEdits) is what blocks the light", () => {
    const c = wallCtx([]);
    let s = inVault(c);
    expect(revealed(s).has("6,2")).toBe(true); // no walls detected: light reaches
    s = executeEngineTool(s, "set_fog", { mode: "reset" }, c).state;
    (s as unknown as { wallEdits: Record<string, { walls: Seg[] }> }).wallEdits = { loc_vault: { walls: vaultWalls() } };
    s = executeEngineTool(s, "set_fog", { mode: "reset" }, c).state;
    expect(revealed(s).has("6,2")).toBe(false);
  });

  it("a monster behind a closed wall stays unseen; opening the door with set_door shows it (F3)", () => {
    const c = wallCtx();
    let s = inVault(c);
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin", x: 6, y: 2 }, c).state;
    const gob = s.tokens.find((t) => t.entityType === "monster")!;
    gob.x = 6;
    gob.y = 2;
    const status = (st: GameState) =>
      (executeEngineTool(st, "get_party_status", {}, c).outcome.output as { monsters: { name: string; unseen?: boolean }[] }).monsters[0]!;
    expect(revealed(s).has("6,2")).toBe(false);
    expect(status(s).unseen).toBe(true);

    const opened = executeEngineTool(s, "set_door", { door_id: "d1", open: true }, c);
    s = opened.state;
    const out = opened.outcome.output as { door: unknown; open: boolean; revealed: number };
    expect(out.open).toBe(true);
    expect(out.revealed).toBeGreaterThan(0);
    expect(revealed(s).has("6,2")).toBe(true);
    expect(status(s).unseen).toBeUndefined();
  });

  it("closing a door never re-fogs explored cells", () => {
    const c = wallCtx();
    let s = inVault(c);
    s = executeEngineTool(s, "set_door", { door_id: "d1", open: true }, c).state;
    const seen = revealed(s);
    expect(seen.has("6,2")).toBe(true);
    s = executeEngineTool(s, "set_door", { door_id: "d1", open: false }, c).state;
    expect(revealed(s)).toEqual(seen);
  });
});
