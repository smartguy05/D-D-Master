import { describe, expect, it } from "vitest";
import { Character, Monster, emptyGameState, type GameState } from "./schemas.js";
import { allMonsters, charactersAt, isAway, isSplit, locationOfCharacter, partyGroups, presentCharacters, sceneState, sceneView } from "./scenes.js";

const LOCS = [
  { id: "loc_hall", name: "Hall" },
  { id: "loc_mill", name: "Old Mill" },
];

/** Thorin and Lyra in the focused Hall; Bram at the Old Mill, mid-fight with a wolf. */
function split(): GameState {
  const s = emptyGameState("c1");
  s.locationId = "loc_hall";
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 10 }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Lyra", maxHp: 10, hp: 10 }),
    Character.parse({ id: "pc_c", playerName: "Kim", name: "Bram", maxHp: 10, hp: 10 }),
  );
  s.tokens = [
    { id: "t1", entityId: "pc_a", entityType: "character", x: 1, y: 1, size: 1 },
    { id: "t2", entityId: "pc_b", entityType: "character", x: 2, y: 1, size: 1 },
  ];
  s.monsters = [Monster.parse({ id: "mon_rat", name: "Rat", maxHp: 1, hp: 1 })];
  s.scenes.loc_mill = {
    tokens: [{ id: "t3", entityId: "pc_c", entityType: "character", x: 0, y: 4, size: 1 }],
    monsters: [Monster.parse({ id: "mon_wolf", name: "Wolf", maxHp: 11, hp: 11 })],
    combat: {
      active: true,
      round: 2,
      turnIndex: 1,
      order: [
        { entityId: "pc_c", entityType: "character", name: "Bram", initiative: 15 },
        { entityId: "mon_wolf", entityType: "monster", name: "Wolf", initiative: 12 },
      ],
      turn: null,
      reactionsUsed: [],
      announced: [],
    },
  };
  s.partyLocations = { pc_c: "loc_mill" };
  return s;
}

describe("party split helpers", () => {
  it("knows where each PC is", () => {
    const s = split();
    expect(locationOfCharacter(s, "pc_a")).toBe("loc_hall");
    expect(locationOfCharacter(s, "pc_c")).toBe("loc_mill");
    expect(isAway(s, "pc_c")).toBe(true);
    expect(isAway(s, "pc_a")).toBe(false);
    expect(presentCharacters(s).map((c) => c.id)).toEqual(["pc_a", "pc_b"]);
    expect(charactersAt(s, "loc_mill").map((c) => c.id)).toEqual(["pc_c"]);
    expect(isSplit(s)).toBe(true);
    expect(isSplit(emptyGameState("c2"))).toBe(false);
  });

  it("sceneView gives the top level for the focus and the stash otherwise", () => {
    const s = split();
    expect(sceneView(s, "loc_hall")).toMatchObject({ focused: true, tokens: s.tokens, monsters: s.monsters });
    const mill = sceneView(s, "loc_mill");
    expect(mill.focused).toBe(false);
    expect(mill.monsters.map((m) => m.id)).toEqual(["mon_wolf"]);
    expect(mill.combat.round).toBe(2);
    expect(sceneView(s, "loc_nowhere")).toMatchObject({ focused: false, tokens: [], monsters: [], combat: { active: false } });
    const st = sceneState(s, "loc_mill");
    expect(st.locationId).toBe("loc_mill");
    expect(st.tokens.map((t) => t.entityId)).toEqual(["pc_c"]);
    expect(sceneState(s, "loc_hall")).toBe(s);
  });

  it("partyGroups lists the focused group first with each group's fight", () => {
    expect(partyGroups(split(), LOCS)).toEqual([
      { locationId: "loc_hall", name: "Hall", focused: true, characterIds: ["pc_a", "pc_b"], names: ["Thorin", "Lyra"], combat: null },
      { locationId: "loc_mill", name: "Old Mill", focused: false, characterIds: ["pc_c"], names: ["Bram"], combat: { round: 2, current: "Wolf" } },
    ]);
    expect(partyGroups(emptyGameState("c2"), LOCS)).toEqual([]);
  });

  it("allMonsters returns every scene's live monster objects", () => {
    const s = split();
    const all = allMonsters(s);
    expect(all.map((m) => m.id)).toEqual(["mon_rat", "mon_wolf"]);
    all[1]!.spriteUrl = "/w.png";
    expect(s.scenes.loc_mill!.monsters[0]!.spriteUrl).toBe("/w.png");
  });
});
