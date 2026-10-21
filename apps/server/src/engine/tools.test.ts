import { describe, expect, it } from "vitest";
import { Character, emptyGameState, type GameState, type Rng } from "@dm/shared";
import { executeEngineTool, type EngineContext } from "./tools.js";

const seq =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

function ctx(rng: Rng = seq(10)): EngineContext {
  return {
    rng,
    monsterTemplate: (name) =>
      name.toLowerCase() === "goblin warrior"
        ? { name: "Goblin Warrior", srdName: "Goblin Warrior", maxHp: 10, ac: 15, initiativeBonus: 2, speed: 30, attacksPerAction: 1, attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2" }], conditions: [], hidden: false, npc: false, appearance: "", ally: false, follows: false, combatant: true, neutral: false, conditionMeta: [] }
        : undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [{ id: "loc_cave", name: "Cave", description: "Dark", mapPrompt: "", fog: false, walls: [], features: [], gridW: 10, gridH: 8 }],
  };
}

function withParty(): GameState {
  const s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, abilities: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 10 } }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 8, hp: 8, diceMode: "physical" }),
  );
  return s;
}

describe("engine tools", () => {
  it("does not mutate the input state", () => {
    const s = withParty();
    const { state } = executeEngineTool(s, "apply_damage", { target_id: "pc_a", amount: 5 }, ctx());
    expect(s.characters[0].hp).toBe(12);
    expect(state.characters[0].hp).toBe(7);
    expect(state.version).toBe(1);
  });

  it("temp hp absorbs damage and hp clamps at 0 with Unconscious", () => {
    let s = withParty();
    s = executeEngineTool(s, "set_temp_hp", { target_id: "Thorin", amount: 4 }, ctx()).state;
    s = executeEngineTool(s, "apply_damage", { target_id: "thorin", amount: 20 }, ctx()).state;
    expect(s.characters[0].tempHp).toBe(0);
    expect(s.characters[0].hp).toBe(0);
    expect(s.characters[0].conditions).toContain("Unconscious");
    s = executeEngineTool(s, "heal", { target_id: "pc_a", amount: 50 }, ctx()).state;
    expect(s.characters[0].hp).toBe(12);
    expect(s.characters[0].conditions).not.toContain("Unconscious");
  });

  it("stacks, removes and validates items", () => {
    let s = withParty();
    s = executeEngineTool(s, "give_item", { character_id: "pc_a", name: "Torch", qty: 2 }, ctx()).state;
    s = executeEngineTool(s, "give_item", { character_id: "pc_a", name: "torch" }, ctx()).state;
    expect(s.characters[0].inventory).toHaveLength(1);
    expect(s.characters[0].inventory[0].qty).toBe(3);
    s = executeEngineTool(s, "remove_item", { character_id: "pc_a", name: "Torch", qty: 3 }, ctx()).state;
    expect(s.characters[0].inventory).toHaveLength(0);
    expect(() => executeEngineTool(s, "remove_item", { character_id: "pc_a", name: "Rope" }, ctx())).toThrow(/no item/);
  });

  it("rejects overspending gold", () => {
    const s = withParty();
    expect(() => executeEngineTool(s, "adjust_gold", { character_id: "pc_a", amount: -5 }, ctx())).toThrow();
  });

  it("rolls for virtual players and defers for physical players", () => {
    const s = withParty();
    const v = executeEngineTool(s, "request_player_roll", { character_id: "pc_a", notation: "1d20+3", label: "Stealth", dc: 12 }, ctx(seq(10)));
    expect(v.outcome.rolls).toHaveLength(1);
    expect(v.outcome.output).toMatchObject({ total: 13, success: true });
    const p = executeEngineTool(s, "request_player_roll", { character_id: "pc_b", notation: "1d20", label: "Perception" }, ctx());
    expect(p.outcome.rolls).toHaveLength(0);
    expect(p.state.pendingRoll?.characterId).toBe("pc_b");
    const r = executeEngineTool(p.state, "record_physical_roll", { character_id: "pc_b", notation: "1d20", label: "Perception", total: 17, dc: 15 }, ctx());
    expect(r.state.pendingRoll).toBeUndefined();
    expect(r.state.rolls.at(-1)).toMatchObject({ physical: true, total: 17, success: true });
  });

  it("record_physical_roll keeps a spoken natural 20/1 as the kept d20 (crit, toast, flourish)", () => {
    const s = withParty();
    const p = executeEngineTool(s, "request_player_roll", { character_id: "pc_b", notation: "1d20+5", label: "Attack" }, ctx());
    const r = executeEngineTool(p.state, "record_physical_roll", { character_id: "pc_b", notation: "1d20+5", label: "Attack", total: 25, natural: 20 }, ctx());
    const roll = r.state.rolls.at(-1)!;
    expect(roll.dice).toEqual([{ sides: 20, value: 20 }]);
    expect(roll.modifier).toBe(5);
    expect(r.outcome.output).toMatchObject({ natural: 20 });
    // Not a d20 roll: the natural is ignored.
    const dmg = executeEngineTool(s, "record_physical_roll", { character_id: "pc_b", notation: "2d6", label: "Damage", total: 7, natural: 1 }, ctx());
    expect(dmg.state.rolls.at(-1)!.dice).toEqual([]);
  });

  it("spawns SRD monsters with stats and numbered names", () => {
    let s = withParty();
    s.locationId = "loc_cave";
    const out = executeEngineTool(s, "spawn_monster", { name: "goblin warrior", count: 2 }, ctx());
    s = out.state;
    expect(s.monsters.map((m) => m.name)).toEqual(["Goblin Warrior 1", "Goblin Warrior 2"]);
    expect(s.monsters[0]).toMatchObject({ ac: 15, maxHp: 10 });
    expect(s.tokens.filter((t) => t.entityType === "monster")).toHaveLength(2);
    const cells = new Set(s.tokens.map((t) => `${t.x},${t.y}`));
    expect(cells.size).toBe(s.tokens.length);
  });

  it("orders initiative and skips dead monsters on next_turn", () => {
    let s = withParty();
    s.locationId = "loc_cave";
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin Warrior", count: 1 }, ctx()).state;
    // Thorin rolls 5 (+2) = 7, Lyra 15 (+0) = 15, goblin 20 (+2) = 22
    s = executeEngineTool(s, "start_combat", {}, ctx(seq(5, 15, 20))).state;
    expect(s.combat.order.map((o) => o.name)).toEqual(["Goblin Warrior", "Lyra", "Thorin"]);
    s = executeEngineTool(s, "apply_damage", { target_id: "Goblin Warrior", amount: 99 }, ctx()).state;
    s = executeEngineTool(s, "next_turn", {}, ctx()).state; // Lyra
    s = executeEngineTool(s, "next_turn", {}, ctx()).state; // Thorin
    const r = executeEngineTool(s, "next_turn", {}, ctx()); // skips dead goblin -> Lyra, round 2
    expect(r.outcome.output).toMatchObject({ current: "Lyra", round: 2 });
  });

  it("remove_monster keeps the current turn on the same creature when an earlier entry is removed", () => {
    let s = withParty();
    s.locationId = "loc_cave";
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin Warrior", count: 1 }, ctx()).state;
    s = executeEngineTool(s, "start_combat", {}, ctx(seq(5, 15, 20))).state; // Goblin, Lyra, Thorin
    s = executeEngineTool(s, "next_turn", {}, ctx()).state; // Lyra
    s = executeEngineTool(s, "next_turn", {}, ctx()).state; // Thorin (index 2)
    s = executeEngineTool(s, "remove_monster", { monster_id: "Goblin Warrior" }, ctx()).state;
    expect(s.combat.order[s.combat.turnIndex].name).toBe("Thorin");
    // Removing the current creature passes the turn to the next one (wrapping to the top).
    let t = withParty();
    t.locationId = "loc_cave";
    t = executeEngineTool(t, "spawn_monster", { name: "Goblin Warrior", count: 1 }, ctx()).state;
    t = executeEngineTool(t, "start_combat", {}, ctx(seq(5, 15, 20))).state;
    t = executeEngineTool(t, "remove_monster", { monster_id: "Goblin Warrior" }, ctx()).state;
    expect(t.combat.order[t.combat.turnIndex].name).toBe("Lyra");
  });

  it("changes scene, clears monsters and places the party", () => {
    let s = withParty();
    s = executeEngineTool(s, "change_scene", { location_id: "Cave" }, ctx()).state;
    expect(s.locationId).toBe("loc_cave");
    expect(s.tokens.filter((t) => t.entityType === "character")).toHaveLength(2);
    expect(() => executeEngineTool(s, "change_scene", { location_id: "nowhere" }, ctx())).toThrow(/Unknown location/);
  });

  it("clamps token moves to the grid and avoids stacking", () => {
    let s = withParty();
    s = executeEngineTool(s, "change_scene", { location_id: "loc_cave" }, ctx()).state;
    s = executeEngineTool(s, "move_token", { entity_id: "pc_a", x: 99, y: -3 }, ctx()).state;
    const t = s.tokens.find((x) => x.entityId === "pc_a")!;
    expect([t.x, t.y]).toEqual([9, 0]);
    s = executeEngineTool(s, "move_token", { entity_id: "pc_b", x: 9, y: 0 }, ctx()).state;
    const t2 = s.tokens.find((x) => x.entityId === "pc_b")!;
    expect([t2.x, t2.y]).not.toEqual([9, 0]);
  });

  it("validates tool args", () => {
    expect(() => executeEngineTool(withParty(), "apply_damage", { target_id: "pc_a" }, ctx())).toThrow();
  });
});

describe("roll_dice roller validation", () => {
  /** A refused call: thrown, or returned as { error }. */
  function refusal(fn: () => ReturnType<typeof executeEngineTool>): { message: string; result?: ReturnType<typeof executeEngineTool> } {
    try {
      const r = fn();
      return { message: String((r.outcome.output as { error?: string } | null)?.error ?? ""), result: r };
    } catch (e) {
      return { message: (e as Error).message };
    }
  }

  it("refuses a roller_id that matches no character or monster (e.g. a removed monster) and adds no roll", () => {
    const s = withParty();
    const { message, result } = refusal(() =>
      executeEngineTool(s, "roll_dice", { notation: "1d20+1", label: "Kobold Warrior 3 Wisdom save vs Sleep", roller_id: "mon_gone" }, ctx()),
    );
    expect(message).toMatch(/Unknown roller/);
    expect(message).toMatch(/get_party_status/);
    if (result) {
      expect(result.outcome.rolls).toHaveLength(0);
      expect(result.state.rolls).toHaveLength(0);
    }
  });

  it("still rolls for the DM with no roller_id, and for a known roller", () => {
    const dm = executeEngineTool(withParty(), "roll_dice", { notation: "1d20", label: "Random encounter" }, ctx());
    expect(dm.outcome.rolls).toHaveLength(1);
    expect(dm.outcome.rolls[0].rollerName).toBe("DM");
    const pc = executeEngineTool(withParty(), "roll_dice", { notation: "1d20", label: "Save", roller_id: "pc_a" }, ctx());
    expect(pc.outcome.rolls[0].rollerName).toBe("Thorin");
  });
});

describe("gold", () => {
  /** The error a tool call gives, whether thrown or returned as { error }. */
  function errorOf(s: GameState, name: string, args: unknown): string | undefined {
    try {
      const r = executeEngineTool(s, name as never, args, ctx());
      return (r.outcome.output as { error?: string })?.error;
    } catch (err) {
      return (err as Error).message;
    }
  }

  function withThree(): GameState {
    const s = withParty();
    s.characters.push(Character.parse({ id: "pc_c", playerName: "Kim", name: "Morra", maxHp: 9, hp: 9 }));
    s.monsters.push({ id: "m1", name: "Kobold", maxHp: 5, hp: 5, ac: 12, initiativeBonus: 2, speed: 30, attacksPerAction: 1, attacks: [], conditions: [], hidden: false, npc: false, appearance: "", ally: false, follows: false, combatant: true, neutral: false, conditionMeta: [] });
    return s;
  }

  it("adjust_gold on a monster says only player characters have gold", () => {
    const s = withThree();
    expect(errorOf(s, "adjust_gold", { character_id: "m1", amount: 10 })).toMatch(/only player characters have gold|not a player character/i);
  });

  it("split_gold shares a reward evenly (225 over 3 = 75 each)", () => {
    const s = withThree();
    const r = executeEngineTool(s, "split_gold" as never, { total: 225, character_ids: ["pc_a", "pc_b", "pc_c"] }, ctx());
    expect(r.state.characters.map((c) => c.gold)).toEqual([75, 75, 75]);
    const text = JSON.stringify(r.outcome.output);
    for (const n of ["Thorin", "Lyra", "Morra"]) expect(text).toContain(n);
    expect(text).toContain("75");
  });

  it("split_gold gives the remainder 1 gp each to the first characters listed (100 over 3 = 34/33/33)", () => {
    const s = withThree();
    const r = executeEngineTool(s, "split_gold" as never, { total: 100, character_ids: ["pc_b", "pc_a", "pc_c"] }, ctx());
    const gold = Object.fromEntries(r.state.characters.map((c) => [c.id, c.gold]));
    expect(gold).toEqual({ pc_a: 33, pc_b: 34, pc_c: 33 });
    expect(JSON.stringify(r.outcome.output)).toMatch(/34/);
  });

  it("split_gold with an unknown id changes nothing", () => {
    const s = withThree();
    let state = s;
    let err: string | undefined;
    try {
      const r = executeEngineTool(s, "split_gold" as never, { total: 90, character_ids: ["pc_a", "pc_nope"] }, ctx());
      err = (r.outcome.output as { error?: string })?.error;
      state = r.state;
    } catch (e) {
      err = (e as Error).message;
    }
    expect(err).toMatch(/pc_nope/);
    expect(state.characters.map((c) => c.gold)).toEqual([0, 0, 0]);
    expect(s.characters.map((c) => c.gold)).toEqual([0, 0, 0]);
  });
});

describe("split_gold edge cases", () => {
  it("a character listed twice does not get a double share", () => {
    const s = withParty();
    const r = executeEngineTool(s, "split_gold" as never, { total: 90, character_ids: ["pc_a", "pc_a", "pc_b"] }, ctx());
    const total = r.state.characters.reduce((n, c) => n + c.gold, 0);
    const a = r.state.characters.find((c) => c.id === "pc_a")!.gold;
    const b = r.state.characters.find((c) => c.id === "pc_b")!.gold;
    expect(total).toBe(90);
    expect(a).toBe(b);
  });
});

// ---- Phase 1: walls, doors (M1, T1) ----

type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
const wseg = (id: string, x1: number, y1: number, x2: number, y2: number, kind: Seg["kind"] = "wall", open = false): Seg => ({ id, x1, y1, x2, y2, kind, open });
/** x=4 top to bottom: wall y 0..2, door d1 y 2..3, window n1 y 5..6, wall elsewhere. */
const hallWalls = (doorOpen = false): Seg[] => [
  wseg("w1", 4, 0, 4, 2),
  wseg("d1", 4, 2, 4, 3, "door", doorOpen),
  wseg("w2", 4, 3, 4, 5),
  wseg("n1", 4, 5, 4, 6, "window"),
  wseg("w3", 4, 6, 4, 10),
];

function wallCtx(walls: Seg[] = hallWalls(), extra: Partial<EngineContext> = {}): EngineContext {
  const base = ctx();
  const hall = { id: "loc_hall", name: "Hall", description: "", mapPrompt: "", fog: false, features: [], gridW: 12, gridH: 10, walls } as unknown as EngineContext["locations"][number];
  const side = { id: "loc_side", name: "Side", description: "", mapPrompt: "", fog: false, features: [], gridW: 8, gridH: 8, walls: [wseg("d7", 2, 2, 3, 2, "door")] } as unknown as EngineContext["locations"][number];
  return { ...base, locations: [hall, side], ...extra };
}

function inHall(c = wallCtx()): GameState {
  let s = executeEngineTool(withParty(), "change_scene", { location_id: "loc_hall" }, c).state;
  const t = s.tokens.find((x) => x.entityId === "pc_a")!;
  t.x = 2;
  t.y = 2;
  return s;
}
const posOf = (s: GameState, id: string) => {
  const t = s.tokens.find((x) => x.entityId === id)!;
  return [t.x, t.y];
};

describe("move_token and walls (M1)", () => {
  it("a closed door seals the route: the token walks up to it and is told why", () => {
    const r = executeEngineTool(inHall(), "move_token", { entity_id: "pc_a", x: 6, y: 2 }, wallCtx());
    expect(r.outcome.output).toMatchObject({ pos: [3, 2], squares: 1, redirected: true, reason: "no open route: walls or closed doors are in the way" });
    expect((r.outcome.output as { note: string }).note).toMatch(/as close as they can and is at \(3, 2\).*set_door/);
    expect(posOf(r.state, "pc_a")).toEqual([3, 2]);
  });

  it("a token already as close as it can get doesn't move, and the error says where it is", () => {
    const s = inHall();
    s.tokens.find((x) => x.entityId === "pc_a")!.x = 3;
    const r = executeEngineTool(s, "move_token", { entity_id: "pc_a", x: 6, y: 2 }, wallCtx());
    expect((r.outcome.output as { error?: string }).error).toMatch(/^Thorin did not move and is still at \(3, 2\)/);
    expect(posOf(r.state, "pc_a")).toEqual([3, 2]);
  });

  it("a window or a wall doesn't let the token through either", () => {
    const s = inHall();
    const t = s.tokens.find((x) => x.entityId === "pc_a")!;
    t.y = 5; // level with the window
    const win = executeEngineTool(s, "move_token", { entity_id: "pc_a", x: 6, y: 5 }, wallCtx());
    expect(posOf(win.state, "pc_a")).toEqual([3, 5]);
    t.y = 0;
    const wall = executeEngineTool(s, "move_token", { entity_id: "pc_a", x: 6, y: 0 }, wallCtx());
    expect(posOf(wall.state, "pc_a")).toEqual([3, 0]);
  });

  it("walks around a wall that has a way past it (the move narrated is the move made)", () => {
    // x=4 wall from y 0 to 8 leaves row 9 open
    const c = wallCtx([wseg("w1", 4, 0, 4, 9)]);
    const r = executeEngineTool(inHall(c), "move_token", { entity_id: "pc_a", x: 6, y: 2 }, c);
    expect(r.outcome.output).toMatchObject({ pos: [6, 2], around: true });
    expect((r.outcome.output as { redirected?: boolean }).redirected).toBeUndefined();
    expect((r.outcome.output as { squares: number }).squares).toBeGreaterThan(4);
    expect(posOf(r.state, "pc_a")).toEqual([6, 2]);
  });

  it("ignore_terrain lets the DM rule a move past a wall (a climb, a jump, a wrong map)", () => {
    const r = executeEngineTool(inHall(), "move_token", { entity_id: "pc_a", x: 6, y: 2, ignore_terrain: true }, wallCtx());
    expect(r.outcome.output).toEqual({ name: "Thorin", pos: [6, 2], squares: 4, terrain_ignored: true });
    expect(posOf(r.state, "pc_a")).toEqual([6, 2]);
  });

  it("a move through an open door succeeds", () => {
    const c = wallCtx(hallWalls(true));
    const r = executeEngineTool(inHall(c), "move_token", { entity_id: "pc_a", x: 6, y: 2 }, c);
    expect((r.outcome.output as { error?: string }).error).toBeUndefined();
    expect(posOf(r.state, "pc_a")).toEqual([6, 2]);
  });

  it("a move on the same side of the wall is unaffected", () => {
    const r = executeEngineTool(inHall(), "move_token", { entity_id: "pc_a", x: 0, y: 7 }, wallCtx());
    expect(posOf(r.state, "pc_a")).toEqual([0, 7]);
  });

  it("a newly created token is placed with no wall check", () => {
    let s = inHall();
    s = executeEngineTool(s, "spawn_monster", { name: "Goblin", x: 1, y: 1 }, wallCtx()).state;
    const m = s.monsters[0]!;
    s.tokens = s.tokens.filter((t) => t.entityId !== m.id);
    const r = executeEngineTool(s, "move_token", { entity_id: m.id, x: 8, y: 2 }, wallCtx());
    expect((r.outcome.output as { error?: string }).error).toBeUndefined();
    expect(posOf(r.state, m.id)).toEqual([8, 2]);
  });

  it("the host may move a token through a wall", () => {
    const host = wallCtx(hallWalls(), { source: "host" });
    const r = executeEngineTool(inHall(host), "move_token", { entity_id: "pc_a", x: 6, y: 2 }, host);
    expect((r.outcome.output as { error?: string }).error).toBeUndefined();
    expect(posOf(r.state, "pc_a")).toEqual([6, 2]);
  });
});

describe("set_door (T1)", () => {
  const wallsOf = (s: GameState, loc: string) => (s as unknown as { wallEdits: Record<string, { walls: Seg[] }> }).wallEdits[loc]?.walls;

  it("opens a door: copies the location's walls into wallEdits and flips only that door", () => {
    const s = inHall();
    const r = executeEngineTool(s, "set_door", { door_id: "d1", open: true }, wallCtx());
    const walls = wallsOf(r.state, "loc_hall")!;
    expect(walls).toHaveLength(5);
    expect(walls.find((w) => w.id === "d1")!.open).toBe(true);
    expect(walls.filter((w) => w.id !== "d1")).toEqual(hallWalls().filter((w) => w.id !== "d1"));
    expect(r.outcome.output).toMatchObject({ open: true });
    // and back
    const closed = executeEngineTool(r.state, "set_door", { door_id: "d1", open: false }, wallCtx());
    expect(wallsOf(closed.state, "loc_hall")!.find((w) => w.id === "d1")!.open).toBe(false);
  });

  it("builds on an existing wall edit", () => {
    const s = inHall();
    (s as unknown as { wallEdits: Record<string, { walls: Seg[] }> }).wallEdits = { loc_hall: { walls: [wseg("d9", 1, 1, 1, 2, "door")] } };
    const r = executeEngineTool(s, "set_door", { door_id: "d9", open: true }, wallCtx());
    expect(wallsOf(r.state, "loc_hall")).toEqual([wseg("d9", 1, 1, 1, 2, "door", true)]);
    expect(() => executeEngineTool(s, "set_door", { door_id: "d1", open: true }, wallCtx())).toThrow(/d9/);
  });

  it("an unknown id or a non-door segment throws and lists the doors", () => {
    const s = inHall();
    expect(() => executeEngineTool(s, "set_door", { door_id: "d42", open: true }, wallCtx())).toThrow(/d1/);
    expect(() => executeEngineTool(s, "set_door", { door_id: "w1", open: true }, wallCtx())).toThrow(/d1/);
    expect(() => executeEngineTool(s, "set_door", { door_id: "n1", open: true }, wallCtx())).toThrow(/d1/);
  });

  it("takes another location by id", () => {
    const s = inHall();
    const r = executeEngineTool(s, "set_door", { door_id: "d7", open: true, location: "loc_side" }, wallCtx());
    expect(wallsOf(r.state, "loc_side")).toEqual([wseg("d7", 2, 2, 3, 2, "door", true)]);
    expect(wallsOf(r.state, "loc_hall")).toBeUndefined();
  });

  it("is open to the DM (not refused like host-only tools), and the engine knows it", async () => {
    const { isEngineTool } = await import("./tools.js");
    expect(isEngineTool("set_door")).toBe(true);
    expect(isEngineTool("edit_walls")).toBe(true);
  });
});
