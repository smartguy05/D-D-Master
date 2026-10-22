import { describe, expect, it } from "vitest";
import { CharacterConstraints } from "@dm/shared";
import { addDrafted, blankSpecies, choicesFromText, choicesToText, classesToSave, removeCustom, renameCustom, tickedClasses, toggleName, traitsFromText, traitsToText } from "./characterRules";

const ALL = ["Barbarian", "Fighter", "Rogue", "Wizard"];

describe("character rules helpers", () => {
  it("toggles names case-insensitively", () => {
    expect(toggleName(["Elf"], "elf", false)).toEqual([]);
    expect(toggleName(["Elf"], "Dwarf", true)).toEqual(["Elf", "Dwarf"]);
    expect(toggleName(["Elf"], "elf", true)).toEqual(["elf"]);
  });

  it("empty class allow-list means every class ticked, and all ticked saves as []", () => {
    expect(tickedClasses([], ALL)).toEqual(ALL);
    expect(tickedClasses(["rogue"], ALL)).toEqual(["Rogue"]);
    expect(classesToSave(ALL, ALL)).toEqual([]);
    expect(classesToSave([], ALL)).toEqual([]);
    expect(classesToSave(["Rogue", "Fighter"], ALL)).toEqual(["Rogue", "Fighter"]);
  });

  it("drafted species are added (replacing same names) and allowed; removing one unlists it", () => {
    const c = CharacterConstraints.parse({ allowedSpecies: ["Halfling"], customSpecies: [{ name: "Sewer Rat", speed: 25 }] });
    const next = addDrafted(c, [{ ...blankSpecies("Sewer Rat"), speed: 35 }, blankSpecies("Brown Rat")]);
    expect(next.customSpecies.map((s) => [s.name, s.speed])).toEqual([["Sewer Rat", 35], ["Brown Rat", 30]]);
    expect(next.allowedSpecies).toEqual(["Halfling", "Sewer Rat", "Brown Rat"]);
    expect(removeCustom(next, 0).allowedSpecies).toEqual(["Halfling", "Brown Rat"]);
  });

  it("renaming a custom species keeps it allowed", () => {
    const c = CharacterConstraints.parse({ allowedSpecies: ["Rat"], customSpecies: [{ name: "Rat" }] });
    const next = renameCustom(c, 0, "Sewer Rat");
    expect(next.allowedSpecies).toEqual(["Sewer Rat"]);
    expect(next.customSpecies[0]!.name).toBe("Sewer Rat");
  });

  it("traits round-trip as 'Name: text' lines", () => {
    const traits = traitsFromText("Squeeze: Move through tiny gaps.\n\nKeen Nose");
    expect(traits).toEqual([{ name: "Squeeze", text: "Move through tiny gaps." }, { name: "Keen Nose", text: "" }]);
    expect(traitsToText({ ...blankSpecies(), traits })).toBe("Squeeze: Move through tiny gaps.\nKeen Nose");
  });

  it("choices round-trip as 'Label [kind]: A / B' lines and keep option extras", () => {
    const prev = choicesFromText("Size [size]: Small / Medium\nRat Lineage: Sewer / Plague");
    expect(prev).toEqual([
      { key: "size", label: "Size", kind: "size", options: [{ name: "Small" }, { name: "Medium" }] },
      { key: "rat_lineage", label: "Rat Lineage", kind: "option", options: [{ name: "Sewer" }, { name: "Plague" }] },
    ]);
    prev[1]!.options[1] = { name: "Plague", cantrips: ["Poison Spray"] };
    const again = choicesFromText(choicesToText({ ...blankSpecies(), choices: prev }), prev);
    expect(again[1]!.options[1]).toEqual({ name: "Plague", cantrips: ["Poison Spray"] });
    expect(choicesFromText("nonsense line")).toEqual([]);
  });
});
