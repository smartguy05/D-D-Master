import { describe, expect, it } from "vitest";
import { Character, GameState, Monster, emptyGameState, isSplit, locationOfCharacter, type Rng } from "@dm/shared";
import { executeEngineTool, type EngineContext } from "./tools.js";
import { expireOrphaned } from "./rules/conditions.js";
import { forgetCharacter, inScene, normalizeScenes } from "./scenes.js";

function ctx(rng: Rng = () => 10): EngineContext {
  return {
    rng,
    monsterTemplate: () => undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [
      { id: "loc_hall", name: "Hall", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 20, gridH: 10 },
      { id: "loc_mill", name: "Old Mill", description: "A ruin.", mapPrompt: "", fog: true, walls: [], features: [], gridW: 16, gridH: 10 },
      { id: "loc_cave", name: "Cave", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 16, gridH: 10 },
    ],
  };
}

const run = (s: GameState, name: Parameters<typeof executeEngineTool>[1], args: unknown, c = ctx()) => executeEngineTool(s, name, args, c);

function party(): GameState {
  let s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12 }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 8, hp: 8 }),
    Character.parse({ id: "pc_c", playerName: "Kim", name: "Bram", maxHp: 10, hp: 10 }),
  );
  return run(s, "change_scene", { location_id: "loc_hall" }).state;
}

function addMonster(s: GameState, m: Partial<Monster> & { id: string; name: string }, x = 10, y = 5) {
  s.monsters.push(Monster.parse({ maxHp: 7, hp: 7, ac: 12, ...m }));
  s.tokens.push({ id: `tok_${m.id}`, entityId: m.id, entityType: "monster", x, y, size: 1 });
}

/** Thorin and Lyra go to the Old Mill; Bram stays in the Hall with a goblin. */
function split(): GameState {
  const s = party();
  addMonster(s, { id: "mon_gob", name: "Goblin" });
  return run(s, "change_scene", { location_id: "loc_mill", character_ids: ["pc_a", "Lyra"] }).state;
}

describe("change_scene without character_ids (party together)", () => {
  it("moves everyone exactly as before: nothing is parked", () => {
    const s = run(party(), "change_scene", { location_id: "loc_cave" }).state;
    expect(s.locationId).toBe("loc_cave");
    expect(s.scenes).toEqual({});
    expect(s.partyLocations).toEqual({});
    expect(s.tokens.filter((t) => t.entityType === "character")).toHaveLength(3);
  });

  it("old saves without scenes or partyLocations load with empty ones", () => {
    const legacy = GameState.parse({ campaignId: "old" });
    expect(legacy.scenes).toEqual({});
    expect(legacy.partyLocations).toEqual({});
  });
});

describe("splitting the party", () => {
  it("focuses the movers' new scene and parks the PCs who stay, with their monsters", () => {
    const { state: s, outcome } = run(
      (() => {
        const p = party();
        addMonster(p, { id: "mon_gob", name: "Goblin" });
        return p;
      })(),
      "change_scene",
      { location_id: "loc_mill", character_ids: ["pc_a", "Lyra"] },
    );
    expect(s.locationId).toBe("loc_mill");
    expect(outcome.sceneChanged).toBe("loc_mill");
    expect(s.partyLocations).toEqual({ pc_c: "loc_hall" });
    expect(s.tokens.map((t) => t.entityId).sort()).toEqual(["pc_a", "pc_b"]);
    expect(s.monsters).toEqual([]);
    expect(s.scenes.loc_hall.tokens.map((t) => t.entityId).sort()).toEqual(["mon_gob", "pc_c"]);
    expect(s.scenes.loc_hall.monsters.map((m) => m.id)).toEqual(["mon_gob"]);
    expect(s.fog.loc_mill.enabled).toBe(true); // first visit applies the location's fog
    expect(locationOfCharacter(s, "pc_c")).toBe("loc_hall");
    const out = outcome.output as { arrived: string[]; other_groups: string[]; instruction: string };
    expect(out.arrived).toEqual(["Thorin", "Lyra"]);
    expect(out.other_groups).toEqual(["Bram at Hall (loc_hall): exploring"]);
    expect(out.instruction).toMatch(/focus_scene/);
  });

  it("refuses PCs already at the destination", () => {
    const s = split();
    expect(() => run(s, "change_scene", { location_id: "loc_mill", character_ids: ["pc_a"] })).toThrow(/already at Old Mill/);
  });

  it("a group reaching the other group's location merges: the scene and its monsters are kept", () => {
    let s = split();
    s = run(s, "change_scene", { location_id: "loc_hall", character_ids: ["pc_a", "pc_b"] }).state;
    expect(s.locationId).toBe("loc_hall");
    expect(isSplit(s)).toBe(false);
    expect(s.partyLocations).toEqual({});
    expect(s.monsters.map((m) => m.id)).toEqual(["mon_gob"]);
    expect(s.tokens.map((t) => t.entityId).sort()).toEqual(["mon_gob", "pc_a", "pc_b", "pc_c"]);
  });

  it("the last PC leaving drops the scene; listed followers travel, unlisted ones stay with the PCs left", () => {
    const s0 = party();
    addMonster(s0, { id: "mon_dog", name: "Dog", follows: true, ally: true });
    addMonster(s0, { id: "mon_cat", name: "Cat", follows: true, ally: true });
    let s = run(s0, "change_scene", { location_id: "loc_mill", character_ids: ["pc_a", "mon_dog"] }).state;
    expect(s.monsters.map((m) => m.id)).toEqual(["mon_dog"]);
    expect(s.scenes.loc_hall.monsters.map((m) => m.id)).toEqual(["mon_cat"]);
    // Lyra and Bram leave the Hall too: it empties, the cat comes along, the Hall is dropped.
    s = run(s, "change_scene", { location_id: "loc_cave", character_ids: ["pc_b", "pc_c"] }).state;
    expect(s.locationId).toBe("loc_cave");
    expect(s.monsters.map((m) => m.id)).toEqual(["mon_cat"]);
    expect(Object.keys(s.scenes)).toEqual(["loc_mill"]);
    expect(s.partyLocations).toEqual({ pc_a: "loc_mill" });
  });

  it("change_scene without ids regroups a split party at the destination", () => {
    const s = run(split(), "change_scene", { location_id: "loc_cave" }).state;
    expect(s.locationId).toBe("loc_cave");
    expect(s.scenes).toEqual({});
    expect(s.partyLocations).toEqual({});
    expect(s.tokens.filter((t) => t.entityType === "character")).toHaveLength(3);
    expect(s.monsters).toEqual([]); // the goblin stayed behind in the Hall
  });
});

describe("combat while split", () => {
  it("start_combat only rolls the PCs in the focused scene; next_turn only advances that fight", () => {
    let s = split();
    s = run(s, "focus_scene", { location_id: "loc_hall" }).state;
    s = run(s, "start_combat", {}).state;
    expect(s.combat.order.map((o) => o.entityId).sort()).toEqual(["mon_gob", "pc_c"]);
    s = run(s, "next_turn", {}).state;
    const frozen = structuredClone(s.combat);
    const out = run(s, "focus_scene", { location_id: "loc_mill" });
    s = out.state;
    expect(s.combat.active).toBe(false);
    expect((out.outcome.output as { left_behind: string }).left_behind).toMatch(/Hall: fight frozen at round 1/);
    expect(s.scenes.loc_hall.combat).toEqual(frozen);
  });

  it("focusing back resumes the frozen fight exactly and shows the turn banner", () => {
    let s = split();
    s = run(s, "focus_scene", { location_id: "loc_hall" }).state;
    s = run(s, "start_combat", {}).state;
    s.pendingRoll = { characterId: "pc_c", notation: "1d20", label: "Athletics", kind: "check" };
    const before = structuredClone({ combat: s.combat, pendingRoll: s.pendingRoll });
    s = run(s, "focus_scene", { location_id: "loc_mill" }).state;
    expect(s.pendingRoll).toBeUndefined();
    const back = run(s, "focus_scene", { location_id: "loc_hall" });
    expect({ combat: back.state.combat, pendingRoll: back.state.pendingRoll }).toEqual(before);
    const cur = before.combat.order[before.combat.turnIndex];
    expect(back.outcome.moments.map((m) => [m.kind, m.targetId])).toEqual([["turn_start", cur.entityId]]);
    expect((back.outcome.output as { instruction: string }).instruction).toMatch(/Resume the fight/);
  });

  it("a PC leaving mid-fight leaves initiative; arriving in a running fight joins it", () => {
    let s = party();
    addMonster(s, { id: "mon_gob", name: "Goblin" });
    s = run(s, "start_combat", {}).state;
    expect(s.combat.order).toHaveLength(4);
    s = run(s, "change_scene", { location_id: "loc_mill", character_ids: ["pc_a"] }).state;
    expect(s.scenes.loc_hall.combat.order.map((o) => o.entityId)).not.toContain("pc_a");
    expect(s.scenes.loc_hall.combat.active).toBe(true);
    const back = run(s, "change_scene", { location_id: "loc_hall", character_ids: ["pc_a"] });
    expect(back.state.combat.order.map((o) => o.entityId)).toContain("pc_a");
    expect((back.outcome.output as { joined_initiative: string[] }).joined_initiative).toEqual(["Thorin (10)"]);
  });

  it("defeat counts only the PCs in the fight", () => {
    let s = split();
    s = run(s, "focus_scene", { location_id: "loc_hall" }).state;
    s = run(s, "start_combat", {}).state;
    const out = run(s, "apply_damage", { target_id: "pc_c", amount: 30 });
    expect(out.outcome.moments.some((m) => m.kind === "defeat")).toBe(true);
  });
});

describe("focus_scene", () => {
  it("refuses a location with nobody there, and is a no-op on the focused one", () => {
    const s = split();
    const empty = run(s, "focus_scene", { location_id: "loc_cave" });
    expect((empty.outcome.output as { error: string }).error).toMatch(/Nobody from the party is at Cave/);
    expect(empty.state.locationId).toBe("loc_mill");
    expect(run(s, "focus_scene", { location_id: "loc_mill" }).outcome.output).toMatchObject({ note: "Already in focus." });
  });

  it("switches the focus both ways without losing tokens", () => {
    let s = split();
    s = run(s, "focus_scene", { location_id: "Hall" }).state;
    expect(s.locationId).toBe("loc_hall");
    expect(s.partyLocations).toEqual({ pc_a: "loc_mill", pc_b: "loc_mill" });
    expect(s.tokens.map((t) => t.entityId).sort()).toEqual(["mon_gob", "pc_c"]);
    s = run(s, "focus_scene", { location_id: "loc_mill" }).state;
    expect(s.tokens.map((t) => t.entityId).sort()).toEqual(["pc_a", "pc_b"]);
  });
});

describe("away PCs can't act in the focused scene", () => {
  it("refuses move_token and attacks for an away PC and creates no token", () => {
    const s = split();
    const mv = run(s, "move_token", { entity_id: "pc_c", x: 2, y: 2 });
    expect((mv.outcome.output as { error: string }).error).toMatch(/Bram is at Hall.*focus_scene loc_hall/);
    expect(mv.state.tokens.some((t) => t.entityId === "pc_c")).toBe(false);
    const atk = run(s, "roll_dice", { notation: "1d20+3", label: "attack", roller_id: "pc_c", target_id: "pc_a" });
    expect((atk.outcome.output as { error: string }).error).toMatch(/Bram is at Hall/);
  });

  it("still allows upkeep: heal and give_item", () => {
    let s = split();
    s.characters.find((c) => c.id === "pc_c")!.hp = 3;
    s = run(s, "heal", { target_id: "pc_c", amount: 5 }).state;
    expect(s.characters.find((c) => c.id === "pc_c")!.hp).toBe(8);
    s = run(s, "give_item", { character_id: "pc_c", name: "Rope" }).state;
    expect(s.characters.find((c) => c.id === "pc_c")!.inventory.some((i) => i.name === "Rope")).toBe(true);
  });

  it("an away PC keeps timed conditions while another scene's fight runs", () => {
    const s = split();
    const bram = s.characters.find((c) => c.id === "pc_c")!;
    bram.conditions.push("Blessed");
    bram.conditionMeta.push({ name: "Blessed", until: { kind: "rounds", entityId: "pc_c", round: 1 } });
    s.combat = { active: true, round: 3, turnIndex: 0, order: [{ entityId: "pc_a", entityType: "character", name: "Thorin", initiative: 10 }], turn: null, reactionsUsed: [], announced: [] };
    expect(expireOrphaned(s)).toEqual([]);
    expect(bram.conditions).toContain("Blessed");
  });

  it("get_party_status says where everyone is and lists the other groups", () => {
    const out = run(split(), "get_party_status", {}).outcome.output as { characters: { name: string; where?: string; pos: unknown }[]; other_groups: string[] };
    expect(out.characters.find((c) => c.name === "Bram")).toMatchObject({ where: "Hall", pos: null });
    expect(out.characters.find((c) => c.name === "Thorin")?.where).toBe("Old Mill");
    expect(out.other_groups).toHaveLength(1);
  });
});

describe("scene helpers", () => {
  it("inScene runs focused-scene code on a parked group and swaps back", () => {
    const s = split();
    const ids = inScene(s, "loc_hall", (x) => x.tokens.map((t) => t.entityId).sort());
    expect(ids).toEqual(["mon_gob", "pc_c"]);
    expect(s.locationId).toBe("loc_mill");
    expect(s.partyLocations).toEqual({ pc_c: "loc_hall" });
  });

  it("forgetCharacter drops a removed PC's location and parked scene", () => {
    const s = split();
    s.characters = s.characters.filter((c) => c.id !== "pc_c");
    forgetCharacter(s, "pc_c");
    expect(s.partyLocations).toEqual({});
    expect(s.scenes).toEqual({});
  });

  it("normalizeScenes returns the same state when consistent and fixes stray entries", () => {
    const s = split();
    expect(normalizeScenes(s)).toBe(s);
    const bad = structuredClone(s);
    bad.partyLocations.pc_a = "loc_mill"; // the focus itself
    bad.partyLocations.ghost = "loc_hall"; // no such PC
    const fixed = normalizeScenes(bad);
    expect(fixed.partyLocations).toEqual({ pc_c: "loc_hall" });
  });
});
