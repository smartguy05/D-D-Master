import { describe, expect, it } from "vitest";
import { CharacterConstraints, emptyGameState, type CharacterBuilder } from "@dm/shared";
import { builderSteps, defaultMaxHp, finalizeDraft, mergeDraft, missingFields, proficiencyBonusFor, startBuilder } from "./builder.js";

const full = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

function builder(draft: CharacterBuilder["draft"], level = 1): CharacterBuilder {
  return { playerId: "plr_1", playerName: "Sam", level, draft, startedAt: 1, updatedAt: 1 };
}

describe("character builder", () => {
  it("starts for a player by id or name", () => {
    const s = emptyGameState("c1");
    s.players.push({ id: "plr_1", name: "Sam", voiceSamples: 0, ai: false, aiPersona: "", aiPaused: false });
    expect(startBuilder(s, "sam", 3, 5)).toMatchObject({ playerId: "plr_1", playerName: "Sam", level: 3, draft: {} });
    expect(s.builder?.playerId).toBe("plr_1");
    expect(() => startBuilder(s, "Nobody", 1)).toThrow(/No player/);
  });

  it("merges scalars, per-score abilities, and replaces lists", () => {
    let d = mergeDraft({}, { name: "Brom", abilities: { str: 15 }, skills: ["Athletics"] });
    d = mergeDraft(d, { species: "Dwarf", abilities: { con: 14 }, skills: ["Perception", "Survival"] });
    d = mergeDraft(d, { name: "Bromm" });
    expect(d).toEqual({ name: "Bromm", species: "Dwarf", abilities: { str: 15, con: 14 }, skills: ["Perception", "Survival"] });
  });

  it("rejects invalid patches", () => {
    expect(() => mergeDraft({}, { abilities: { str: 40 } })).toThrow();
    expect(() => mergeDraft({}, { diceMode: "telepathic" })).toThrow();
  });

  it("lists missing required fields", () => {
    expect(missingFields({})).toEqual(["name", "species", "className", "abilities (str, dex, con, int, wis, cha)"]);
    expect(missingFields({ name: "A", species: "Elf", className: "Wizard", abilities: { ...full, cha: undefined as never } })).toEqual(["abilities (cha)"]);
  });

  it("refuses to finalize an incomplete draft", () => {
    const r = finalizeDraft(builder({ name: "Brom" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("species");
  });

  it("finalizes with derived HP, AC and proficiency bonus", () => {
    const r = finalizeDraft(
      builder({ name: " Brom ", species: "Dwarf", className: "Fighter", abilities: full, inventory: [{ name: "Rope", qty: 1 }] }, 5),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // d10 fighter, CON 13 (+1): 10+1 at level 1, then 4 x (6+1)
    expect(r.character).toMatchObject({ name: "Brom", playerName: "Sam", level: 5, maxHp: 39, ac: 12, proficiencyBonus: 3, diceMode: "virtual" });
    expect(r.character.inventory?.[0]).toMatchObject({ name: "Rope", qty: 1 });
  });

  it("carries the personality fields into the character", () => {
    const r = finalizeDraft(builder({ name: "Ivy", species: "Elf", className: "Wizard", abilities: full, personality: "Curious.", flaws: "Reckless.", backstory: "Left the tower." }));
    expect(r.ok && r.character).toMatchObject({ personality: "Curious.", ideals: "", bonds: "", flaws: "Reckless.", backstory: "Left the tower." });
  });

  it("keeps explicit HP/AC and knows hit dice", () => {
    const r = finalizeDraft(builder({ name: "Ivy", species: "Elf", className: "Wizard", abilities: full, maxHp: 9, ac: 15 }));
    expect(r.ok && r.character).toMatchObject({ maxHp: 9, ac: 15 });
    expect(defaultMaxHp("Wizard", 1, 14)).toBe(8);
    expect(defaultMaxHp("Barbarian", 1, 16)).toBe(15);
    expect(defaultMaxHp("Homebrew", 1, 10)).toBe(8);
    expect(proficiencyBonusFor(1)).toBe(2);
    expect(proficiencyBonusFor(9)).toBe(4);
  });
});

describe("character builder: campaign constraints", () => {
  const rats = CharacterConstraints.parse({
    allowedSpecies: ["Sewer Rat"],
    allowedClasses: ["Rogue"],
    customSpecies: [{ name: "Sewer Rat", speed: 35, traits: [{ name: "Squeeze", text: "" }] }],
  });

  it("finalize refuses a species or class the campaign doesn't allow", () => {
    const res = finalizeDraft(builder({ name: "Pip", species: "Elf", className: "Wizard", abilities: full }), rats);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues?.map((i) => i.code)).toEqual(["species_not_allowed", "class_not_allowed"]);
  });

  it("finalize takes a custom species' speed and traits", () => {
    const res = finalizeDraft(builder({ name: "Pip", species: "Sewer Rat", className: "Rogue", abilities: full }), rats);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.character.speed).toBe(35);
      expect(res.character.features).toEqual(["Squeeze"]);
    }
  });

  it("the interview offers only the allowed options", () => {
    const steps = builderSteps(builder({}), rats);
    expect(steps).toContain("Allowed species (only these): Sewer Rat.");
    expect(steps).toContain("Allowed classes (only these): Rogue.");
    expect(steps).not.toContain("Offer SRD 5.2 options");
    expect(builderSteps(builder({}))).toContain("Offer SRD 5.2 options");
  });
});
