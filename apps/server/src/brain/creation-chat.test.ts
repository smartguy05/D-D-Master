import { describe, expect, it, vi } from "vitest";
import type { ChatTurn, CreationChoices, CreationIssue, CreationOptions } from "@dm/shared";
import type { CompleteOptions, LLMProvider } from "./provider.js";
import { catalogText, creationPrompt, creationSystem, historyText, HISTORY_CHARS, MAX_CALLS, patchErrors, runCreationTurn, TURN_CHARS, type ChatDeps, type ChatInput } from "./creation-chat.js";

const OPTIONS: CreationOptions = {
  classes: [
    { name: "Fighter", hitDie: 10, skillChoices: { count: 2, options: ["Athletics", "Survival"] }, equipment: [{ letter: "A", items: [{ name: "Chain Mail", qty: 1 }], gold: 4 }], subclass: "Champion", subclassLevel: 3, asiLevels: [], cantrips: 0, preparedSpells: 0, maxSpellLevel: 0, savingThrows: ["str", "con"], fightingStyle: true, armorTraining: ["light"] },
    { name: "Wizard", hitDie: 6, skillChoices: { count: 2, options: ["Arcana", "History"] }, equipment: [], subclass: "Evoker", subclassLevel: 3, asiLevels: [], cantrips: 3, preparedSpells: 4, maxSpellLevel: 1, spellcasting: "int", savingThrows: ["int", "wis"], fightingStyle: false, armorTraining: [] },
  ],
  species: [{ name: "Elf", creatureType: "Humanoid", speed: 30, cantrips: [], traits: [{ name: "Darkvision", text: "" }], choices: [{ key: "elven_lineage", label: "Elven Lineage", kind: "option", options: [{ name: "Drow" }, { name: "High Elf" }] }] }],
  backgrounds: [{ name: "Sage", abilities: ["con", "int", "wis"], feat: "Magic Initiate (Wizard)", skills: ["Arcana", "History"], tool: "", equipment: [{ letter: "B", items: [], gold: 50 }] }],
  feats: [
    { name: "Alert", category: "origin", text: "", repeatable: false },
    { name: "Defense", category: "fighting_style", text: "", repeatable: false },
  ],
  spells: { Wizard: [{ name: "Fire Bolt", level: 0 }, { name: "Magic Missile", level: 1 }, { name: "Fireball", level: 3 }], Fighter: [] },
};

const input = (over: Partial<ChatInput> = {}): ChatInput => ({
  playerName: "Sam",
  level: 1,
  methods: ["standard_array"],
  allowHomebrew: false,
  options: OPTIONS,
  choices: {},
  errors: [{ field: "name", code: "missing", message: "Give your character a name." }],
  warnings: [],
  derived: "",
  history: [],
  text: "I want a sneaky elf wizard",
  ...over,
});

/** A fake brain answering from a queue of JSON replies. */
function fakeLlm(replies: object[]) {
  const calls: CompleteOptions[] = [];
  const llm: LLMProvider = {
    name: "fake",
    model: "fake",
    complete: vi.fn(async (o: CompleteOptions) => {
      calls.push(o);
      const r = replies.shift();
      if (!r) throw new Error("no more replies");
      return JSON.stringify(r);
    }),
  };
  return { llm, calls };
}

/** apply(): merges onto `start` and reports the errors a checker function gives. */
function deps(check: (c: CreationChoices) => CreationIssue[], start: CreationChoices = {}): ChatDeps & { applied: CreationChoices[] } {
  const applied: CreationChoices[] = [];
  return {
    applied,
    apply: (patch) => {
      const choices = { ...start, ...patch };
      applied.push(choices);
      return { choices, errors: check(choices), warnings: [], derived: "" };
    },
    lookup: (q) => `SRD about ${q}`,
  };
}

describe("prompts", () => {
  it("the system prompt states the hard constraints and lists the SRD options", () => {
    const sys = creationSystem(input({ methods: ["point_buy"], allowHomebrew: false, level: 3 }));
    expect(sys).toContain("level 3 character");
    expect(sys).toContain("point buy (27 points");
    expect(sys).toContain("Never set derived numbers");
    expect(sys).toContain("- Fighter (d10; skills: 2 of Athletics/Survival");
    expect(sys).toContain("needs fightingStyle");
    expect(sys).toContain("- Elf (speed 30; Darkvision; choices elven_lineage: Drow/High Elf)");
    expect(sys).toContain("- Sage (bonuses among con/int/wis; feat Magic Initiate (Wizard)");
    expect(sys).not.toContain("homebrew from the table");
    expect(creationSystem(input({ allowHomebrew: true }))).toContain("homebrew from the table");
  });

  it("spell lists only for the chosen class (up to its spell level) and the Magic Initiate list", () => {
    expect(catalogText(OPTIONS, {}, 1)).not.toContain("SPELLS:");
    const wiz = catalogText(OPTIONS, { className: "Wizard" }, 1);
    expect(wiz).toContain("WIZARD SPELLS: cantrips: Fire Bolt; level 1: Magic Missile");
    expect(wiz).not.toContain("Fireball");
    expect(catalogText(OPTIONS, { className: "Fighter", background: "Sage" }, 1)).toContain("WIZARD SPELLS");
  });

  it("the prompt carries the choices, the errors, the SRD text and the new line", () => {
    const p = creationPrompt(input({ choices: { name: "Ilsa" } }), { rules: "Elves: trance." });
    expect(p).toContain('CURRENT CHOICES (JSON):\n{"name":"Ilsa"}');
    expect(p).toContain("- name: Give your character a name.");
    expect(p).toContain("SRD TEXT:\nElves: trance.");
    expect(p).toMatch(/PLAYER NOW: I want a sneaky elf wizard$/);
  });

  it("history keeps the newest turns, cuts long ones and stays within the budget", () => {
    const turns: ChatTurn[] = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "ai" : "player", text: `${i} ${"x".repeat(i === 29 ? 2000 : 10)}`, ts: i }));
    const h = historyText(turns);
    expect(h).not.toContain("PLAYER: 0 ");
    expect(h.split("\n").at(-1)).toMatch(/^YOU: 29 x+…$/);
    expect(h.split("\n").at(-1)!.length).toBeLessThanOrEqual(TURN_CHARS + 10);
    expect(h.length).toBeLessThanOrEqual(HISTORY_CHARS + 30);
  });
});

describe("runCreationTurn", () => {
  it("one call: the reply, the merged choices and the portrait flag", async () => {
    const { llm, calls } = fakeLlm([{ reply: "A High Elf wizard it is!", patch: { species: "Elf", className: "Wizard", speciesChoices: { elven_lineage: "High Elf" } }, drawPortrait: false }]);
    const d = deps(() => []);
    const r = await runCreationTurn(llm, input(), d);
    expect(r).toMatchObject({ reply: "A High Elf wizard it is!", calls: 1, drawPortrait: false, choices: { species: "Elf", className: "Wizard" } });
    expect(calls[0].prompt).toContain("SRD about I want a sneaky elf wizard");
    expect(calls[0].maxTokens).toBeGreaterThanOrEqual(8000);
  });

  it("a lookup round: the SRD text for the model's searches, then the answer", async () => {
    const { llm, calls } = fakeLlm([
      { reply: "", patch: {}, lookups: ["Elf trance"] },
      { reply: "Elves don't sleep.", patch: {} },
    ]);
    const r = await runCreationTurn(llm, input({ text: "do elves sleep?" }), deps(() => []));
    expect(r.reply).toBe("Elves don't sleep.");
    expect(calls[1].prompt).toContain("SRD about Elf trance");
    expect(r.calls).toBe(2);
  });

  it("repairs what its patch broke; errors in untouched fields don't trigger a repair", async () => {
    const { llm, calls } = fakeLlm([
      { reply: "Skills set!", patch: { classSkills: ["Arcana", "Stealth"] } },
      { reply: "Skills set: Arcana and History.", patch: { classSkills: ["Arcana", "History"] } },
    ]);
    const check = (c: CreationChoices) => [
      ...(c.classSkills?.includes("Stealth") ? [{ field: "classSkills", code: "not_offered", message: "Stealth isn't a Wizard skill choice." }] : []),
      { field: "name", code: "missing", message: "Give your character a name." },
    ];
    const r = await runCreationTurn(llm, input({ choices: { className: "Wizard" } }), deps(check, { className: "Wizard" }));
    expect(r.choices.classSkills).toEqual(["Arcana", "History"]);
    expect(r.reply).toBe("Skills set: Arcana and History.");
    expect(calls[1].prompt).toContain("THE SERVER REJECTED PARTS OF YOUR PATCH:\n- classSkills: Stealth isn't a Wizard skill choice.");
    expect(r.calls).toBe(2);
  });

  it("stops at MAX_CALLS and keeps the last applied attempt", async () => {
    const bad = { reply: "Fireball!", patch: { spells: ["Fireball"] } };
    const { llm } = fakeLlm([bad, bad, bad, bad, bad]);
    const check = (c: CreationChoices) => (c.spells?.includes("Fireball") ? [{ field: "spells", code: "too_high", message: "Fireball is level 3." }] : []);
    const r = await runCreationTurn(llm, input(), deps(check));
    expect(r.calls).toBe(MAX_CALLS);
    expect(r.choices.spells).toEqual(["Fireball"]);
  });

  it("a model error is thrown to the caller (the service turns it into a chat note)", async () => {
    const { llm } = fakeLlm([]);
    await expect(runCreationTurn(llm, input(), deps(() => []))).rejects.toThrow(/no more replies/);
  });
});

describe("patchErrors", () => {
  it("only errors on fields the patch set (and their sub-fields)", () => {
    const errors = [
      { field: "speciesChoices.elven_lineage", code: "x", message: "" },
      { field: "name", code: "x", message: "" },
    ];
    expect(patchErrors({ speciesChoices: { elven_lineage: "Wood" } }, errors).map((e) => e.field)).toEqual(["speciesChoices.elven_lineage"]);
    expect(patchErrors({}, errors)).toEqual([]);
    expect(patchErrors({ name: "", classSkills: [] }, errors)).toEqual([]);
  });
});
