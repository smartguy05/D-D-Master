import { describe, expect, it } from "vitest";
import { CharacterConstraints, checkConstraints, classAllowed, cleanNames, constraintsText, findCustomSpecies, speciesAllowed } from "./constraints.js";
import { Campaign } from "./schemas.js";

const rats = CharacterConstraints.parse({
  allowedSpecies: ["Sewer Rat", "Brown Rat"],
  allowedClasses: ["Rogue", "Fighter"],
  customSpecies: [
    { name: "Sewer Rat", description: "Scrappy tunnel rats.", speed: 35, darkvision: 60, traits: [{ name: "Squeeze", text: "Move through tiny gaps." }] },
    { name: "Brown Rat", choices: [{ key: "size", label: "Size", kind: "size", options: [{ name: "Small" }, { name: "Medium" }] }] },
  ],
});

describe("CharacterConstraints", () => {
  it("defaults to no restriction and old campaigns parse", () => {
    const c = Campaign.parse({ id: "cmp_1", name: "Old", createdAt: 1, updatedAt: 1 });
    expect(c.constraints).toEqual({ allowedSpecies: [], allowedClasses: [], customSpecies: [] });
    expect(speciesAllowed("Elf", c.constraints)).toBe(true);
    expect(classAllowed("Wizard", c.constraints)).toBe(true);
    expect(checkConstraints({ species: "Elf", className: "Wizard" }, c.constraints)).toEqual([]);
  });

  it("fills custom species defaults", () => {
    const brown = findCustomSpecies("brown rat", rats)!;
    expect(brown.speed).toBe(30);
    expect(brown.creatureType).toBe("Humanoid");
    expect(brown.traits).toEqual([]);
  });

  it("matches species case-insensitively and accepts lineages", () => {
    expect(speciesAllowed("sewer rat", rats)).toBe(true);
    expect(speciesAllowed("Elf", rats)).toBe(false);
    const elves = CharacterConstraints.parse({ allowedSpecies: ["Elf"] });
    expect(speciesAllowed("Wood Elf", elves)).toBe(true);
    expect(speciesAllowed("Elf (Drow)", elves)).toBe(true);
    expect(speciesAllowed("Shelfling", elves)).toBe(false);
  });

  it("reports species and class issues with the allowed list", () => {
    const issues = checkConstraints({ species: "Elf", className: "Wizard" }, rats);
    expect(issues.map((i) => i.code)).toEqual(["species_not_allowed", "class_not_allowed"]);
    expect(issues[0].message).toContain("Sewer Rat, Brown Rat");
    expect(issues[1].message).toContain("Rogue, Fighter");
    expect(checkConstraints({ species: "Sewer Rat", className: "rogue" }, rats)).toEqual([]);
    expect(checkConstraints({ species: "", className: "" }, rats)).toEqual([]);
  });

  it("describes the rules for prompts", () => {
    const text = constraintsText(rats);
    expect(text).toContain("Allowed species (only these): Sewer Rat, Brown Rat.");
    expect(text).toContain("Allowed classes (only these): Rogue, Fighter.");
    expect(text).toContain("Custom species Sewer Rat (Humanoid, speed 35 ft, darkvision 60 ft) — Scrappy tunnel rats. Traits: Squeeze");
    expect(text).toContain("Choices: Size: Small/Medium");
    expect(constraintsText(CharacterConstraints.parse({}))).toBe("");
  });

  it("cleans name lists", () => {
    expect(cleanNames([" Elf ", "elf", "", "Dwarf"])).toEqual(["Elf", "Dwarf"]);
  });
});
