import { describe, expect, it } from "vitest";
import { Character } from "@dm/shared";
import { d20, damageNotation, saveMod, skillMod } from "./sheet";

const c = Character.parse({
  id: "pc",
  playerName: "Sam",
  name: "Thorin",
  maxHp: 10,
  hp: 10,
  proficiencyBonus: 2,
  abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 13, cha: 10 },
  skills: ["athletics"],
  savingThrows: ["Strength", "CON"],
});

describe("player sheet helpers", () => {
  it("adds proficiency to proficient skills and saves", () => {
    expect(skillMod(c, "Athletics", "str")).toBe(5);
    expect(skillMod(c, "Stealth", "dex")).toBe(1);
    expect(saveMod(c, "str")).toBe(5);
    expect(saveMod(c, "con")).toBe(4);
    expect(saveMod(c, "int")).toBe(-1);
  });
  it("builds d20 notation with advantage", () => {
    expect(d20(5)).toBe("1d20+5");
    expect(d20(-1, "adv")).toBe("2d20kh1-1");
    expect(d20(0, "dis")).toBe("2d20kl1");
  });
  it("extracts damage dice", () => {
    expect(damageNotation("1d8+3 slashing")).toBe("1d8+3");
    expect(damageNotation("2d6 fire")).toBe("2d6");
    expect(damageNotation("special")).toBeUndefined();
  });
});
