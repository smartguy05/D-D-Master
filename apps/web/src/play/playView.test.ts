import { describe, expect, it } from "vitest";
import { Character, GameState, SceneStash } from "@dm/shared";
import { sheetAttention } from "./playView";

function state() {
  return GameState.parse({
    campaignId: "c",
    locationId: "inn",
    characters: [Character.parse({ id: "mara", playerName: "Sam", name: "Mara", maxHp: 10, hp: 10 }), Character.parse({ id: "bo", playerName: "Ana", name: "Bo", maxHp: 10, hp: 10 })],
  });
}

describe("sheetAttention (the /play sheet drawer asks to be opened)", () => {
  it("nothing out of combat with no roll asked", () => {
    expect(sheetAttention(state(), "mara")).toBeUndefined();
  });

  it("a physical roll the DM waits for from this character, in the focused scene", () => {
    const s = state();
    s.pendingRoll = { characterId: "mara", kind: "check", label: "Stealth", notation: "1d20+3" } as GameState["pendingRoll"];
    expect(sheetAttention(s, "mara")).toBe("roll");
    expect(sheetAttention(s, "bo")).toBeUndefined();
  });

  it("this character's turn (a projected turnIndex of -1 is nobody's)", () => {
    const s = state();
    s.combat.active = true;
    s.combat.order = [
      { entityId: "mara", entityType: "character", name: "Mara", initiative: 15 },
      { entityId: "bo", entityType: "character", name: "Bo", initiative: 9 },
    ];
    s.combat.turnIndex = 0;
    expect(sheetAttention(s, "mara")).toBe("turn");
    expect(sheetAttention(s, "bo")).toBeUndefined();
    s.combat.turnIndex = -1;
    expect(sheetAttention(s, "mara")).toBeUndefined();
  });

  it("a party split: a roll or turn in a scene the DM isn't running waits (the sheet says so itself)", () => {
    const s = state();
    s.partyLocations = { mara: "cave" };
    // The parked scene's own roll and fight (in its stash), both Mara's: without the focus check these would be "roll" / "turn".
    s.scenes = {
      cave: SceneStash.parse({
        pendingRoll: { characterId: "mara", kind: "check", label: "Stealth", notation: "1d20+3" },
        combat: { active: true, turnIndex: 0, order: [{ entityId: "mara", entityType: "character", name: "Mara", initiative: 15 }] },
      }),
    };
    expect(sheetAttention(s, "mara")).toBeUndefined();
    delete s.scenes.cave!.pendingRoll;
    expect(sheetAttention(s, "mara")).toBeUndefined();
    // Once the DM focuses the cave, both count again.
    s.partyLocations = {};
    s.locationId = "cave";
    s.pendingRoll = { characterId: "mara", kind: "check", label: "Stealth", notation: "1d20+3" } as GameState["pendingRoll"];
    expect(sheetAttention(s, "mara")).toBe("roll");
  });

  it("no character: nothing", () => {
    expect(sheetAttention(state(), undefined)).toBeUndefined();
  });
});
