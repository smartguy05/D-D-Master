import { describe, expect, it } from "vitest";
import { Character, emptyGameState } from "@dm/shared";
import { characterPlaces, spotlightRows } from "./partyGroups";

const LOCS = [
  { id: "loc_hall", name: "Hall" },
  { id: "loc_mill", name: "Old Mill" },
];

function split() {
  const s = emptyGameState("c1");
  s.locationId = "loc_hall";
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 10 }),
    Character.parse({ id: "pc_c", playerName: "Kim", name: "Bram", maxHp: 10, hp: 10 }),
  );
  s.scenes.loc_mill = {
    tokens: [],
    monsters: [],
    combat: { active: true, round: 2, turnIndex: 0, order: [{ entityId: "pc_c", entityType: "character", name: "Bram", initiative: 12 }], turn: null, reactionsUsed: [], announced: [] },
  };
  s.partyLocations = { pc_c: "loc_mill" };
  return s;
}

describe("host spotlight rows", () => {
  it("one row per group, the focused one first, a frozen fight marked", () => {
    expect(spotlightRows(split(), LOCS)).toEqual([
      { locationId: "loc_hall", name: "Hall", focused: true, members: "Thorin", fight: undefined },
      { locationId: "loc_mill", name: "Old Mill", focused: false, members: "Bram", fight: "⚔ round 2 · Bram's turn (frozen)" },
    ]);
  });

  it("lists each PC's location", () => {
    expect(characterPlaces(split())).toEqual([
      { id: "pc_a", name: "Thorin", locationId: "loc_hall" },
      { id: "pc_c", name: "Bram", locationId: "loc_mill" },
    ]);
  });
});
