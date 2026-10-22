import { describe, expect, it } from "vitest";
import type { CreationChoices } from "@dm/shared";
import { mergeChoices } from "./draft.js";

const base: CreationChoices = {
  name: "Mara",
  speciesChoices: { size: "Medium" },
  baseAbilities: { str: 15, dex: 14 },
  backgroundBonuses: { str: 2, con: 1 },
  classSkills: ["Athletics", "Survival"],
  featPicks: { background: { cantrips: ["Light"], spell: "Bless" } },
  subclass: "Champion",
  maxHpOverride: 14,
};

describe("mergeChoices", () => {
  it("scalars overwrite, records merge per key, lists replace", () => {
    const next = mergeChoices(base, { name: "Mira", speciesChoices: { skillful: "Stealth" }, baseAbilities: { con: 13 }, classSkills: ["Acrobatics", "History"], featPicks: { background: { spell: "Command" } } });
    expect(next).toMatchObject({
      name: "Mira",
      speciesChoices: { size: "Medium", skillful: "Stealth" },
      baseAbilities: { str: 15, dex: 14, con: 13 },
      classSkills: ["Acrobatics", "History"],
      featPicks: { background: { cantrips: ["Light"], spell: "Command" } },
    });
    expect(base.name).toBe("Mara"); // not mutated
  });

  it("a 0 bonus removes that ability's bonus; clear removes whole fields", () => {
    const next = mergeChoices(base, { backgroundBonuses: { con: 0, dex: 1 } }, { clear: ["maxHpOverride", "subclass", "nope"] });
    expect(next.backgroundBonuses).toEqual({ str: 2, dex: 1 });
    expect(next.maxHpOverride).toBeUndefined();
    expect(next.subclass).toBeUndefined();
  });

  it("clear runs first, so clear + value replaces a record", () => {
    expect(mergeChoices(base, { baseAbilities: { con: 13 } }, { clear: ["baseAbilities"] }).baseAbilities).toEqual({ con: 13 });
  });

  it("from the AI, empty strings, lists and objects mean 'no change'", () => {
    const next = mergeChoices(base, { name: "", classSkills: [], speciesChoices: {}, baseAbilities: {}, backstory: "Raised in a mill.", subclass: "" }, { fromAi: true });
    expect(next).toMatchObject({ name: "Mara", classSkills: ["Athletics", "Survival"], speciesChoices: { size: "Medium" }, subclass: "Champion", backstory: "Raised in a mill." });
  });

  it("from a player, an empty string clears the field", () => {
    expect(mergeChoices(base, { subclass: "" }).subclass).toBe("");
  });

  it("rejects bad input (ZodError)", () => {
    expect(() => mergeChoices(base, { baseAbilities: { str: 99 } })).toThrow();
    expect(() => mergeChoices(base, { abilityMethod: "cheat" })).toThrow();
  });
});
