import { describe, expect, it } from "vitest";
import { Character, GameState } from "./schemas.js";

/** A character exactly as saved before the rules engine (no slots, hit dice, death saves...). */
const OLD_CHARACTER = {
  id: "pc_old",
  playerName: "Sam",
  name: "Lyra",
  className: "Wizard",
  level: 5,
  maxHp: 27,
  hp: 20,
  spells: ["Fireball"],
};

describe("rules fields on Character", () => {
  it("old saves without the rules fields still parse, with zeroed defaults", () => {
    const c = Character.parse(OLD_CHARACTER);
    expect(c.subclass).toBe("");
    expect(c.spellSlots).toEqual([]);
    expect(c.pactSlots).toBeUndefined();
    expect(c.hitDice).toEqual({ die: 8, max: 0, used: 0 });
    expect(c.deathSaves).toMatchObject({ successes: 0, failures: 0, stable: false });
    expect(c.concentration).toBeNull();
    expect(c.resources).toEqual([]);
  });

  it("keeps rules fields that are set", () => {
    const c = Character.parse({
      ...OLD_CHARACTER,
      subclass: "Evoker",
      spellSlots: [{ level: 1, max: 4, used: 2 }],
      pactSlots: { level: 3, max: 2, used: 1 },
      hitDice: { die: 6, max: 5, used: 1 },
      deathSaves: { successes: 1, failures: 2, stable: false },
      concentration: { spell: "Bless", since: 5 },
      resources: [{ name: "Arcane Recovery", max: 1, used: 0, resetOn: "long", note: "x" }],
    });
    expect(c.spellSlots[0]).toEqual({ level: 1, max: 4, used: 2 });
    expect(c.concentration).toEqual({ spell: "Bless", since: 5 });
    expect(c.resources[0]).toMatchObject({ name: "Arcane Recovery", resetOn: "long" });
    expect(() => Character.parse({ ...OLD_CHARACTER, deathSaves: { failures: 4 } })).toThrow();
  });

  it("an old pendingRoll without kind defaults to a check", () => {
    const s = GameState.parse({ campaignId: "c", characters: [OLD_CHARACTER], pendingRoll: { characterId: "pc_old", notation: "1d20", label: "Stealth" } });
    expect(s.pendingRoll?.kind).toBe("check");
    const d = GameState.parse({ campaignId: "c", pendingRoll: { characterId: "pc_old", notation: "1d20", label: "Death save", dc: 10, kind: "death_save" } });
    expect(d.pendingRoll?.kind).toBe("death_save");
  });

  it("a pending physical damage roll keeps its kind and target", () => {
    const s = GameState.parse({ campaignId: "c", pendingRoll: { characterId: "pc_old", notation: "1d8+3", label: "Longsword damage", kind: "damage", targetId: "m1" } });
    expect(s.pendingRoll).toMatchObject({ kind: "damage", targetId: "m1" });
  });
});

describe("death save turn tracking", () => {
  it("deathSaves.lastRolled defaults to null and old saves still parse", () => {
    const c = Character.parse(OLD_CHARACTER);
    expect((c.deathSaves as { lastRolled?: unknown }).lastRolled).toBeNull();
    const withTurn = Character.parse({ ...OLD_CHARACTER, deathSaves: { successes: 1, failures: 0, stable: false, lastRolled: { round: 2, entityId: "pc_old" } } });
    expect((withTurn.deathSaves as { lastRolled?: unknown }).lastRolled).toEqual({ round: 2, entityId: "pc_old" });
  });

  it("conditionMeta defaults to [] and keeps linked spell conditions", () => {
    expect((Character.parse(OLD_CHARACTER) as { conditionMeta?: unknown }).conditionMeta).toEqual([]);
    const meta = [{ name: "Blessed", casterId: "pc_c", spell: "Bless", until: { kind: "concentration" } }];
    expect((Character.parse({ ...OLD_CHARACTER, conditions: ["Blessed"], conditionMeta: meta }) as { conditionMeta?: unknown }).conditionMeta).toEqual(meta);
  });
});
