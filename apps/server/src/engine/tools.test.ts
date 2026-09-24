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
        ? { name: "Goblin Warrior", srdName: "Goblin Warrior", maxHp: 10, ac: 15, initiativeBonus: 2, attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2" }], conditions: [], hidden: false }
        : undefined,
    locations: [{ id: "loc_cave", name: "Cave", description: "Dark", mapPrompt: "", gridW: 10, gridH: 8 }],
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
