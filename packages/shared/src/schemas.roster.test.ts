import { describe, expect, it } from "vitest";
import * as shared from "./index.js";
import * as schemas from "./schemas.js";
import { Character, GameState, emptyGameState } from "./schemas.js";

// RosterEntry does not exist yet (RED): read it off the module so this file still compiles.
const RosterEntry = (schemas as unknown as Record<string, { parse: (v: unknown) => any; safeParse: (v: unknown) => { success: boolean } }>).RosterEntry;

const oldCharacter = { id: "pc_old", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 9 };

describe("Character.rosterId", () => {
  it("an old saved character without rosterId parses with rosterId undefined", () => {
    const c = Character.parse(oldCharacter);
    expect(c.rosterId).toBeUndefined();
    expect("rosterId" in c ? c.rosterId : undefined).toBeUndefined();
  });

  it("an old saved GameState (no rosterId anywhere) still parses", () => {
    const raw = JSON.parse(JSON.stringify(emptyGameState("cmp_old")));
    raw.characters = [oldCharacter, { ...oldCharacter, id: "pc_two", name: "Bryn" }];
    raw.players = [{ id: "plr_1", name: "Sam", characterId: "pc_old", voiceSamples: 2 }];
    const s = GameState.parse(raw);
    expect(s.characters).toHaveLength(2);
    expect(s.characters.every((c) => c.rosterId === undefined)).toBe(true);
  });

  it("a character with rosterId round-trips unchanged", () => {
    const c = Character.parse({ ...oldCharacter, rosterId: "ros_abc" });
    expect(c.rosterId).toBe("ros_abc");
    expect(Character.parse(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("the Character schema declares rosterId as an optional string", () => {
    expect(Object.keys(Character.shape)).toContain("rosterId");
    expect(Character.safeParse({ ...oldCharacter, rosterId: 5 }).success).toBe(false);
  });
});

describe("RosterEntry", () => {
  it("is exported from schemas and the package index", () => {
    expect(RosterEntry).toBeDefined();
    expect((shared as Record<string, unknown>).RosterEntry).toBe(RosterEntry);
  });

  it("fills the defaults from {id, name, updatedAt}", () => {
    const e = RosterEntry.parse({ id: "ros_1", name: "Mara", updatedAt: 5 });
    expect(e).toEqual({
      id: "ros_1",
      name: "Mara",
      playerName: "",
      className: "",
      subclass: "",
      level: 1,
      species: "",
      hasVoiceprint: false,
      updatedAt: 5,
    });
    expect(e.spriteUrl).toBeUndefined();
    expect(e.campaignsPlayed).toBeUndefined();
  });

  it("keeps every field when given", () => {
    const full = {
      id: "ros_2",
      name: "Mara",
      playerName: "Sam",
      className: "Fighter",
      subclass: "Champion",
      level: 5,
      species: "Human",
      spriteUrl: "/media/roster/ros_2.png",
      hasVoiceprint: true,
      updatedAt: 99,
      campaignsPlayed: 2,
    };
    expect(RosterEntry.parse(full)).toEqual(full);
  });

  it("rejects a level outside 1-20 and a missing id/name/updatedAt", () => {
    expect(RosterEntry.safeParse({ id: "r", name: "n", updatedAt: 1, level: 0 }).success).toBe(false);
    expect(RosterEntry.safeParse({ id: "r", name: "n", updatedAt: 1, level: 21 }).success).toBe(false);
    expect(RosterEntry.safeParse({ id: "r", name: "n", updatedAt: 1, level: 2.5 }).success).toBe(false);
    expect(RosterEntry.safeParse({ name: "n", updatedAt: 1 }).success).toBe(false);
    expect(RosterEntry.safeParse({ id: "r", updatedAt: 1 }).success).toBe(false);
    expect(RosterEntry.safeParse({ id: "r", name: "n" }).success).toBe(false);
  });
});
