import { describe, expect, it } from "vitest";
import { defaultSavingThrows } from "./saves.js";
import { makeCharacter, rulesCtx } from "./testing.js";

const ctx = rulesCtx();

describe("defaultSavingThrows", () => {
  it("fills empty saving throw proficiencies from the SRD class (Fighter: STR, CON)", () => {
    expect(ctx.classData("Fighter")!.savingThrows).toEqual(["str", "con"]);
    const c = defaultSavingThrows(makeCharacter({ id: "pc_f", name: "Brienne", className: "Fighter" }), ctx.classData);
    expect(c.savingThrows).toEqual(["str", "con"]);
  });

  it("keeps saving throws that are already set", () => {
    const c = defaultSavingThrows(makeCharacter({ id: "pc_f", name: "Brienne", className: "Fighter", savingThrows: ["dex"] }), ctx.classData);
    expect(c.savingThrows).toEqual(["dex"]);
  });

  it("leaves a non-SRD or classless character alone", () => {
    expect(defaultSavingThrows(makeCharacter({ id: "pc_a", name: "Art", className: "Artificer" }), ctx.classData).savingThrows).toEqual([]);
    expect(defaultSavingThrows(makeCharacter({ id: "pc_n", name: "Nobody" }), ctx.classData).savingThrows).toEqual([]);
  });
});
