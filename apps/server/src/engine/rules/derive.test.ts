import { describe, expect, it } from "vitest";
import { GameState } from "@dm/shared";
import { applyDerived, deriveClassResources, rulesStatus, rulesSummary, upgradeCharacters } from "./derive.js";
import { makeCharacter, rulesCtx, stateWith } from "./testing.js";

const ctx = rulesCtx();
const wizard = (over = {}) =>
  makeCharacter({ id: "pc_w", name: "Lyra", className: "Wizard", level: 5, abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 }, ...over });

describe("deriveClassResources", () => {
  it("gives a Wizard 5 slots [4,3,2], 5d6 hit dice and Arcane Recovery", () => {
    const d = deriveClassResources(wizard(), ctx.classData("Wizard"));
    expect(d.spellSlots).toEqual([
      { level: 1, max: 4, used: 0 },
      { level: 2, max: 3, used: 0 },
      { level: 3, max: 2, used: 0 },
    ]);
    expect(d.pactSlots).toBeUndefined();
    expect(d.hitDice).toEqual({ die: 6, max: 5, used: 0 });
    expect(d.resources.map((r) => r.name)).toEqual(["Arcane Recovery"]);
    expect(d.resources[0]).toMatchObject({ max: 1, used: 0, resetOn: "long" });
  });

  it("gives a Warlock 5 two pact slots at level 3 and no regular slots", () => {
    const d = deriveClassResources(makeCharacter({ id: "pc_k", name: "Kel", className: "Warlock", level: 5 }), ctx.classData("Warlock"));
    expect(d.spellSlots).toEqual([]);
    expect(d.pactSlots).toEqual({ level: 3, max: 2, used: 0 });
    expect(d.hitDice.die).toBe(8);
  });

  it("keeps what was already spent, capped at the new max", () => {
    const c = wizard({
      spellSlots: [
        { level: 1, max: 4, used: 3 },
        { level: 3, max: 2, used: 2 },
      ],
      hitDice: { die: 6, max: 5, used: 4 },
      resources: [{ name: "Arcane Recovery", max: 1, used: 1, resetOn: "long" }],
    });
    const d = deriveClassResources({ ...c, level: 6 }, ctx.classData("Wizard"));
    expect(d.spellSlots.find((s) => s.level === 1)).toEqual({ level: 1, max: 4, used: 3 });
    expect(d.spellSlots.find((s) => s.level === 3)).toEqual({ level: 3, max: 3, used: 2 });
    expect(d.hitDice).toEqual({ die: 6, max: 6, used: 4 });
    expect(d.resources[0].used).toBe(1);
    const down = deriveClassResources({ ...c, hitDice: { die: 6, max: 5, used: 5 }, level: 1 }, ctx.classData("Wizard"));
    expect(down.hitDice.used).toBe(1);
    expect(down.spellSlots).toEqual([{ level: 1, max: 2, used: 2 }]);
  });

  it("adds subclass resources only for the class's own SRD subclass", () => {
    const fiend = makeCharacter({ id: "pc_k", name: "Kel", className: "Warlock", level: 6, subclass: "Fiend", abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 18 } });
    expect(deriveClassResources(fiend, ctx.classData("Warlock")).resources.map((r) => r.name)).toContain("Dark One's Own Luck");
    expect(deriveClassResources({ ...fiend, subclass: "Berserker" }, ctx.classData("Warlock")).resources.map((r) => r.name)).not.toContain("Dark One's Own Luck");
  });

  it("unknown classes still get hit dice (d8) and nothing else", () => {
    const d = deriveClassResources(makeCharacter({ id: "x", name: "X", className: "Artificer", level: 3 }), undefined);
    expect(d).toMatchObject({ hitDice: { die: 8, max: 3, used: 0 }, spellSlots: [], resources: [] });
    expect(d.pactSlots).toBeUndefined();
    // Slots and resources the host set by hand for a homebrew class are kept.
    const homebrew = makeCharacter({ id: "x", name: "X", className: "Artificer", level: 3, spellSlots: [{ level: 1, max: 3, used: 1 }], pactSlots: { level: 1, max: 1, used: 0 }, resources: [{ name: "Flash", max: 2, used: 1, resetOn: "short" }] });
    const kept = deriveClassResources({ ...homebrew, level: 4 }, undefined);
    expect(kept).toMatchObject({ spellSlots: homebrew.spellSlots, pactSlots: homebrew.pactSlots, resources: homebrew.resources, hitDice: { max: 4 } });
  });

  it("is pure", () => {
    const c = wizard();
    const before = structuredClone(c);
    deriveClassResources(c, ctx.classData("Wizard"));
    applyDerived(structuredClone(c), ctx.classData("Wizard"));
    expect(c).toEqual(before);
  });
});

describe("upgradeCharacters (old saves)", () => {
  // An old save, as stored before the rules engine: no slots, hit dice, death saves or resources.
  const OLD_SAVE = {
    campaignId: "c_old",
    characters: [
      { id: "pc_w", playerName: "Alex", name: "Lyra", className: "Wizard", level: 5, maxHp: 27, hp: 27, abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 } },
      { id: "pc_f", playerName: "Sam", name: "Thorin", className: "Fighter", level: 2, maxHp: 20, hp: 9 },
    ],
    pendingRoll: { characterId: "pc_f", notation: "1d20", label: "Stealth" },
  };

  it("derives zeroed defaults from the class tables", () => {
    const loaded = GameState.parse(OLD_SAVE);
    const up = upgradeCharacters(loaded, ctx.classData);
    expect(up).not.toBe(loaded);
    expect(loaded.characters[0].hitDice.max).toBe(0); // input untouched
    const [w, f] = up.characters;
    expect(w.spellSlots.map((s) => s.max)).toEqual([4, 3, 2]);
    expect(w.hitDice).toEqual({ die: 6, max: 5, used: 0 });
    expect(f.hitDice).toEqual({ die: 10, max: 2, used: 0 });
    expect(f.resources.map((r) => `${r.name} ${r.max}`)).toEqual(["Second Wind 2", "Action Surge 1"]);
    expect(f.hp).toBe(9);
    expect(up.pendingRoll?.kind).toBe("check");
  });

  it("returns the same state when nothing needs deriving, and never clobbers set values", () => {
    const up = upgradeCharacters(GameState.parse(OLD_SAVE), ctx.classData);
    expect(upgradeCharacters(up, ctx.classData)).toBe(up);
    const custom = structuredClone(up);
    custom.characters[0].spellSlots = [{ level: 1, max: 9, used: 1 }];
    expect(upgradeCharacters(custom, ctx.classData)).toBe(custom);
  });

  it("works on a state with no characters", () => {
    const s = stateWith();
    expect(upgradeCharacters(s, ctx.classData)).toBe(s);
  });
});

describe("rules summaries", () => {
  it("formats slots (left/max), pact slots, hit dice, concentration, resources and death saves compactly", () => {
    const c = wizard({
      spellSlots: [
        { level: 1, max: 4, used: 2 },
        { level: 2, max: 3, used: 3 },
      ],
      hitDice: { die: 6, max: 5, used: 1 },
      concentration: { spell: "Bless", since: 1 },
      resources: [{ name: "Arcane Recovery", max: 1, used: 0, resetOn: "long" }],
    });
    expect(rulesSummary(c)).toBe("slots 1:2/4 2:0/3; HD 4/5 d6; conc Bless; Arcane Recovery 1/1");
    const k = makeCharacter({ id: "k", name: "K", hp: 0, pactSlots: { level: 3, max: 2, used: 1 }, hitDice: { die: 8, max: 5, used: 0 }, deathSaves: { successes: 1, failures: 2, stable: false } });
    expect(rulesSummary(k)).toBe("pact L3 1/2; HD 5/5 d8; DOWN saves S1 F2");
    expect(rulesSummary({ ...k, deathSaves: { successes: 0, failures: 0, stable: true } })).toContain("STABLE");
    expect(rulesSummary({ ...k, conditions: ["Dead"] })).toContain("DEAD");
    expect(rulesStatus(c)).toMatchObject({ slots: "1:2/4 2:0/3", hitDice: "4/5 d6", concentration: "Bless", resources: ["Arcane Recovery 1/1"] });
    expect(rulesStatus(c).deathSaves).toBeUndefined();
    expect(rulesStatus(k).deathSaves).toEqual({ successes: 1, failures: 2, stable: false });
  });
});
