import { describe, expect, it } from "vitest";
import { Character, type SpellChipInfo } from "@dm/shared";
import {
  adjustPact,
  personaRows,
  adjustSlots,
  characterActions,
  d20,
  damageNotation,
  deathSaveView,
  hitDiceLabel,
  levelUpOutcome,
  pips,
  restSummary,
  resourceRows,
  rulesLine,
  saveMod,
  shortRestArgs,
  shortRestRows,
  skillMod,
  slotRows,
  sortSpellNames,
  tableRulesView,
  spellTags,
  toolError,
} from "./sheet";

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

const wiz = (over: Record<string, unknown> = {}) =>
  Character.parse({
    id: "pc_w",
    playerName: "Ana",
    name: "Mira",
    className: "Wizard",
    level: 5,
    maxHp: 27,
    hp: 20,
    spellSlots: [
      { level: 2, max: 3, used: 3 },
      { level: 1, max: 4, used: 1 },
      { level: 3, max: 2, used: 0 },
    ],
    hitDice: { die: 6, max: 5, used: 2 },
    resources: [{ name: "Arcane Recovery", max: 1, used: 0, note: "Short Rest: regain slots" }],
    ...over,
  });

describe("rules state helpers", () => {
  it("pips: filled = available", () => {
    expect(pips(4, 1)).toEqual([true, true, true, false]);
    expect(pips(2, 5)).toEqual([false, false]);
    expect(pips(0, 0)).toEqual([]);
  });

  it("slot rows are sorted by level, skip empty pools and add Pact Magic last", () => {
    const c = wiz({ spellSlots: [{ level: 2, max: 3, used: 3 }, { level: 1, max: 4, used: 1 }, { level: 4, max: 0, used: 0 }], pactSlots: { level: 3, max: 2, used: 1 } });
    const rows = slotRows(c);
    expect(rows.map((r) => [r.label, r.left, r.max, r.pact])).toEqual([
      ["1st", 3, 4, false],
      ["2nd", 0, 3, false],
      ["Pact 3rd", 1, 2, true],
    ]);
    expect(rows[0].pips).toEqual([true, true, true, false]);
  });

  it("hides the Pact row when the pact pool is empty", () => {
    expect(slotRows(wiz({ pactSlots: { level: 1, max: 0, used: 0 } })).some((r) => r.pact)).toBe(false);
    expect(slotRows(wiz({ spellSlots: [], pactSlots: { level: 1, max: 0, used: 0 } }))).toEqual([]);
  });

  it("formats hit dice as left/max dN, hidden when not derived", () => {
    expect(hitDiceLabel(wiz())).toBe("3/5 d6");
    expect(hitDiceLabel(wiz({ hitDice: { die: 8, max: 0, used: 0 } }))).toBeUndefined();
  });

  it("resource rows show uses left; pips only for small pools", () => {
    const c = wiz({ resources: [{ name: "Rage", max: 3, used: 1, resetOn: "long", shortRestRegain: 1 }, { name: "Focus Points", max: 12, used: 2, resetOn: "short" }] });
    const [rage, focus] = resourceRows(c);
    expect(rage).toMatchObject({ name: "Rage", left: 2, max: 3, reset: "Long Rest (1 back on a Short Rest)" });
    expect(rage.pips).toEqual([true, true, false]);
    expect(focus).toMatchObject({ left: 10, max: 12, reset: "Short Rest", pips: undefined });
  });

  it("TV view: slots (Pact last) and resources with uses, nothing when there is nothing to track", () => {
    const caster = tableRulesView(wiz({ spellSlots: [{ level: 2, max: 2, used: 0 }, { level: 1, max: 4, used: 1 }], pactSlots: { level: 3, max: 2, used: 1 } }))!;
    expect(caster.slots.map((r) => r.label)).toEqual(["1st", "2nd", "Pact 3rd"]);
    const barb = tableRulesView(
      wiz({
        spellSlots: [],
        resources: [
          { name: "Rage", max: 3, used: 1, resetOn: "long", shortRestRegain: 1 },
          { name: "Lay On Hands", max: 25, used: 5, resetOn: "long" },
          { name: "Unused", max: 0, used: 0, resetOn: "long" },
        ],
      }),
    )!;
    expect(barb.slots).toEqual([]);
    expect(barb.resources.map((r) => [r.name, r.left, r.pips?.length])).toEqual([
      ["Rage", 2, 3],
      ["Lay On Hands", 20, undefined],
    ]);
    expect(tableRulesView(wiz({ spellSlots: [], resources: [] }))).toBeUndefined();
  });

  it("death-save view only at 0 HP: dying pips, stable, dead", () => {
    expect(deathSaveView(wiz())).toBeUndefined();
    expect(deathSaveView(wiz({ hp: 0, deathSaves: { successes: 1, failures: 2 } }))).toEqual({
      state: "dying",
      successes: [true, false, false],
      failures: [true, true, false],
    });
    expect(deathSaveView(wiz({ hp: 0, deathSaves: { stable: true } }))).toEqual({ state: "stable" });
    expect(deathSaveView(wiz({ hp: 0, conditions: ["Dead"], deathSaves: { failures: 3 } }))).toEqual({ state: "dead" });
    // Dead wins even if HP was edited above 0 by hand.
    expect(deathSaveView(wiz({ conditions: ["dead"] }))).toEqual({ state: "dead" });
  });

  it("compact rules line for the host party list", () => {
    const c = wiz({ concentration: { spell: "Haste", since: 1 }, pactSlots: { level: 1, max: 1, used: 0 } });
    expect(rulesLine(c)).toBe("slots 1:3/4 2:0/3 3:2/2 · pact L1 1/1 · HD 3/5 d6 · conc Haste · Arcane Recovery 1/1");
    expect(rulesLine(wiz({ hp: 0, spellSlots: [], resources: [], deathSaves: { successes: 2, failures: 1 } }))).toBe("HD 3/5 d6 · DOWN S2 F1");
    expect(rulesLine(wiz({ hp: 0, spellSlots: [], resources: [], deathSaves: { stable: true } }))).toBe("HD 3/5 d6 · STABLE");
    expect(rulesLine(wiz({ hp: 0, spellSlots: [], resources: [], conditions: ["Dead"] }))).toBe("HD 3/5 d6 · DEAD");
  });

  it("which host buttons a character state allows", () => {
    expect(characterActions(wiz())).toEqual({ stabilize: false, revive: false, endConcentration: false, levelUp: true, rest: true });
    expect(characterActions(wiz({ concentration: { spell: "Bless", since: 0 } })).endConcentration).toBe(true);
    expect(characterActions(wiz({ hp: 0 }))).toMatchObject({ stabilize: true, revive: false, rest: false, levelUp: true });
    expect(characterActions(wiz({ hp: 0, deathSaves: { stable: true } })).stabilize).toBe(false);
    expect(characterActions(wiz({ hp: 0, conditions: ["Dead"] }))).toMatchObject({ stabilize: false, revive: true, levelUp: false, rest: false });
    expect(characterActions(wiz({ level: 20 })).levelUp).toBe(false);
  });

  it("slot adjusters clamp used between 0 and max and leave other levels alone", () => {
    const c = wiz();
    expect(adjustSlots(c, 1, 1).find((s) => s.level === 1)?.used).toBe(2);
    expect(adjustSlots(c, 2, 1).find((s) => s.level === 2)?.used).toBe(3);
    expect(adjustSlots(c, 3, -1).find((s) => s.level === 3)?.used).toBe(0);
    expect(adjustSlots(c, 1, -5).map((s) => [s.level, s.used])).toEqual([[2, 3], [1, 0], [3, 0]]);
    expect(c.spellSlots[1].used).toBe(1); // input untouched
    const pc = wiz({ pactSlots: { level: 3, max: 2, used: 1 } });
    expect(adjustPact(pc, 1)).toEqual({ level: 3, max: 2, used: 2 });
    expect(adjustPact(pc, 5)?.used).toBe(2);
    expect(adjustPact(wiz(), 1)).toBeUndefined();
  });
});

describe("short rest panel", () => {
  const a = wiz();
  const b = wiz({ id: "pc_b", name: "Bran", hp: 0 });
  const d = wiz({ id: "pc_d", name: "Dee", hitDice: { die: 10, max: 3, used: 3 } });

  it("rows: dice available, and who cannot rest at 0 HP", () => {
    expect(shortRestRows([a, b, d])).toEqual([
      { id: "pc_w", name: "Mira", available: 3, die: 6, canRest: true },
      { id: "pc_b", name: "Bran", available: 3, die: 6, canRest: false, reason: "at 0 HP" },
      { id: "pc_d", name: "Dee", available: 0, die: 10, canRest: true },
    ]);
  });

  it("builds short_rest args: resting PCs only, dice clamped to what is left, zeros dropped", () => {
    expect(shortRestArgs([a, b, d], { pc_w: 9, pc_b: 2, pc_d: 1 })).toEqual({ character_ids: ["pc_w", "pc_d"], hit_dice: { pc_w: 3 } });
    expect(shortRestArgs([a, d], {})).toEqual({ character_ids: ["pc_w", "pc_d"] });
    expect(shortRestArgs([b], { pc_b: 1 })).toBeUndefined();
    expect(shortRestArgs([a], { pc_w: -2 })).toEqual({ character_ids: ["pc_w"] });
  });
});

describe("tool results", () => {
  it("reads errors returned in a tool result", () => {
    expect(toolError({ error: "nope" })).toBe("nope");
    expect(toolError({ ok: true })).toBeUndefined();
    expect(toolError("text")).toBeUndefined();
    expect(toolError(null)).toBeUndefined();
  });

  it("level-up outcome: done, subclass needed, or error", () => {
    expect(levelUpOutcome({ name: "Mira", level: 3, hp_gain: 4, new_features: [{ name: "Evoker", text: "" }] })).toEqual({ kind: "ok", message: "Mira is now level 3 (+4 HP). New: Evoker" });
    expect(levelUpOutcome({ name: "Mira", level: 2, hp_gain: 4, new_features: [] })).toEqual({ kind: "ok", message: "Mira is now level 2 (+4 HP)." });
    expect(levelUpOutcome({ error: "must choose a subclass", subclass_options: ["Evoker"] })).toEqual({ kind: "subclass", message: "must choose a subclass", options: ["Evoker"] });
    expect(levelUpOutcome({ error: "already level 20" })).toEqual({ kind: "error", message: "already level 20" });
    expect(levelUpOutcome({ name: "Fen", level: 3, hp_gain: 6, new_features: [], note: "Echo Knight is not the SRD subclass (Champion): add its features by hand." })).toEqual({
      kind: "ok",
      message: "Fen is now level 3 (+6 HP). Echo Knight is not the SRD subclass (Champion): add its features by hand.",
    });
  });
});

describe("rest summary", () => {
  it("short rest: HP and dice per character, recovered features, skipped ones", () => {
    const res = {
      rest: "short",
      characters: [
        { name: "Mira", hit_dice_spent: 2, healed: 7, hp: "27/27", recovered: ["Pact Magic slots"] },
        { name: "Bran", skipped: "needs at least 1 Hit Point to rest" },
        { name: "Dee", hit_dice_spent: 0, healed: 0, hp: "10/10" },
      ],
    };
    expect(restSummary(res)).toBe("Short Rest. Mira +7 HP (2 Hit Dice), recovered Pact Magic slots. Bran skipped (needs at least 1 Hit Point to rest). Dee rested.");
  });
  it("long rest", () => {
    expect(restSummary({ rest: "long", characters: [{ name: "Mira", hp: "27/27" }, { name: "Bran", skipped: "x" }] })).toBe("Long Rest. Mira 27/27 HP. Bran skipped (x).");
    expect(restSummary("weird")).toBe("Done.");
  });
});

describe("spell chips", () => {
  const chips: SpellChipInfo[] = [
    { name: "Fireball", known: true, level: 3, concentration: false, ritual: false },
    { name: "Pickle Ray", known: false },
    { name: "Fire Bolt", known: true, level: 0 },
    { name: "Detect Magic", known: true, level: 1, concentration: true, ritual: true },
  ];

  it("level badge and tags", () => {
    expect(spellTags(chips[0])).toEqual({ badge: "3", title: "Level 3", concentration: false, ritual: false });
    expect(spellTags(chips[2])).toEqual({ badge: "0", title: "Cantrip", concentration: false, ritual: false });
    expect(spellTags(chips[3])).toMatchObject({ badge: "1", concentration: true, ritual: true });
    expect(spellTags(chips[1])).toEqual({ badge: "?", title: "Not in the SRD", concentration: false, ritual: false });
    expect(spellTags(undefined)).toEqual({ badge: "…", title: "Loading", concentration: false, ritual: false });
  });

  it("sorts by level (cantrips first), unknown last, sheet order kept within a level", () => {
    expect(sortSpellNames(["Fireball", "Pickle Ray", "Fire Bolt", "Detect Magic", "Shield"], chips)).toEqual(["Fire Bolt", "Detect Magic", "Fireball", "Pickle Ray", "Shield"]);
  });
});

describe("personaRows", () => {
  it("lists only filled personality fields, trimmed, in sheet order", () => {
    expect(personaRows({ personality: " Blunt. ", ideals: "", bonds: "My sister.", flaws: "  ", backstory: "Ex-soldier." })).toEqual([
      { label: "Personality", text: "Blunt." },
      { label: "Bonds", text: "My sister." },
      { label: "Backstory", text: "Ex-soldier." },
    ]);
  });
});
