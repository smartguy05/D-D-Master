import { describe, expect, it } from "vitest";
import { Character, emptyGameState } from "@dm/shared";
import { awayTag, otherGroupLines } from "./otherGroups";

const LOCS = [
  { id: "loc_hall", name: "Hall" },
  { id: "loc_mill", name: "Old Mill" },
];

function state(split: boolean) {
  const s = emptyGameState("c1");
  s.locationId = "loc_hall";
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 10 }),
    Character.parse({ id: "pc_c", playerName: "Kim", name: "Bram", maxHp: 10, hp: 10 }),
  );
  if (split) {
    s.scenes.loc_mill = {
      tokens: [],
      monsters: [],
      combat: { active: true, round: 2, turnIndex: 0, order: [{ entityId: "pc_c", entityType: "character", name: "Bram", initiative: 12 }], turn: null, reactionsUsed: [], announced: [] },
    };
    s.partyLocations = { pc_c: "loc_mill" };
  }
  return s;
}

describe("TV: other groups while the party is split", () => {
  it("one line per group off screen, with its frozen fight", () => {
    expect(otherGroupLines(state(true), LOCS)).toEqual(["Bram · Old Mill · ⏸ ⚔ round 2"]);
    expect(otherGroupLines(state(false), LOCS)).toEqual([]);
  });

  it("tags only away PCs", () => {
    expect(awayTag(state(true), "pc_c", LOCS)).toBe("@ Old Mill");
    expect(awayTag(state(true), "pc_a", LOCS)).toBeUndefined();
    expect(awayTag(state(false), "pc_c", LOCS)).toBeUndefined();
  });
});
