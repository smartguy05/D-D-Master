import { describe, expect, it } from "vitest";
import type { CreationView } from "@dm/shared";
import { actionFor, applyBonusPattern, bonusPattern, issuesFor, panelMode, pointsLeft, setArrayScore, stepIssues, STEPS, toggleInList } from "./view";

const view = (over: Partial<CreationView> = {}, draft: Partial<CreationView["draft"]> = {}): CreationView => ({
  draft: { playerId: "p1", status: "draft", choices: {}, portraitDraws: 0, portraitBusy: false, playerNote: "", hostMessage: "", chat: [], chatBusy: false, updatedAt: 0, ...draft },
  validation: { ok: false, errors: [], warnings: [] },
  preview: null,
  level: 1,
  settings: { abilityMethods: ["standard_array"], allowHomebrew: false, phoneCreation: true },
  locked: false,
  hasOtherCharacter: false,
  ...over,
});

describe("setArrayScore (standard array / rolled pool)", () => {
  it("assigns a value; one already used elsewhere swaps into the old slot", () => {
    expect(setArrayScore({ str: 15, dex: 14 }, "dex", 15)).toEqual({ str: 14, dex: 15 });
    expect(setArrayScore({ str: 15 }, "con", 15)).toEqual({ con: 15 });
    expect(setArrayScore({ str: 15 }, "str", undefined)).toEqual({});
  });
});

describe("pointsLeft", () => {
  it("27 minus the cost; NaN-safe for scores outside 8–15", () => {
    expect(pointsLeft({ str: 15, dex: 15, con: 15 })).toBe(0);
    expect(pointsLeft({})).toBe(27);
    expect(pointsLeft({ str: 16 })).toBeNaN();
  });
});

describe("background bonus patterns", () => {
  it("reads and writes +2/+1 and +1/+1/+1", () => {
    expect(bonusPattern({ str: 2, con: 1 })).toEqual({ kind: "21", plus2: "str", plus1: "con" });
    expect(bonusPattern({ str: 1, dex: 1, con: 1 })).toEqual({ kind: "111" });
    expect(bonusPattern({})).toEqual({ kind: "21" });
    expect(applyBonusPattern(["str", "dex", "con"], { kind: "111" })).toEqual({ str: 1, dex: 1, con: 1 });
    expect(applyBonusPattern(["str", "dex", "con"], { kind: "21", plus2: "dex", plus1: "dex" })).toEqual({ dex: 2 });
    expect(applyBonusPattern(["str", "dex", "con"], { kind: "21", plus2: "dex", plus1: "str" })).toEqual({ dex: 2, str: 1 });
  });
});

describe("toggleInList", () => {
  it("adds, removes, and won't pass the limit", () => {
    expect(toggleInList(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(toggleInList(["a", "b"], "a", 2)).toEqual(["b"]);
    expect(toggleInList(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });
});

describe("issues by field and by step", () => {
  const v = view({
    validation: {
      ok: false,
      errors: [
        { field: "speciesChoices.elven_lineage", code: "missing", message: "lineage" },
        { field: "classSkills", code: "count", message: "skills" },
        { field: "name", code: "missing", message: "name" },
      ],
      warnings: [{ field: "appearance", code: "missing", message: "look" }],
    },
  });
  it("matches a field and its sub-fields", () => {
    expect(issuesFor(v.validation, "speciesChoices").map((i) => i.message)).toEqual(["lineage"]);
    expect(issuesFor(v.validation, "classSkills").map((i) => i.message)).toEqual(["skills"]);
  });
  it("counts errors per step; every validator field belongs to a step", () => {
    expect(stepIssues(v.validation, "origin").errors).toBe(1);
    expect(stepIssues(v.validation, "class").errors).toBe(1);
    expect(stepIssues(v.validation, "details")).toEqual({ errors: 1, warnings: 1 });
    const fields = ["name", "species", "speciesChoices.x", "className", "subclass", "background", "abilityMethod", "baseAbilities", "backgroundBonuses", "asi", "asi.0", "featPicks.background", "fightingStyle", "classSkills", "cantrips", "spells", "classEquipment", "backgroundEquipment", "maxHpOverride", "acOverride", "appearance"];
    for (const f of fields) expect(STEPS.some((s) => s.fields.some((p) => f === p || f.startsWith(`${p}.`))), f).toBe(true);
  });
});

describe("actionFor (the main button)", () => {
  it("join when valid, send to the host when not, save edits once joined", () => {
    expect(actionFor(view({ validation: { ok: true, errors: [], warnings: [] }, preview: {} as never }))).toEqual({ kind: "join", label: "Join the party" });
    expect(actionFor(view({ preview: {} as never })).kind).toBe("submit");
    expect(actionFor(view({ validation: { ok: true, errors: [], warnings: [] }, preview: {} as never }, { status: "joined", characterId: "pc_1" }))).toEqual({ kind: "join", label: "Save changes" });
    expect(actionFor(view({}, { status: "pending" })).kind).toBe("withdraw");
    expect(actionFor(view({ preview: null })).kind).toBe("none");
    expect(actionFor(view({ locked: true }, { status: "joined", characterId: "pc_1" })).kind).toBe("none");
  });
});

describe("panelMode (what the phone shows)", () => {
  it("creation when the seat has no character; edit button only for its own joined, unlocked one", () => {
    expect(panelMode(view(), false)).toBe("create");
    expect(panelMode(view({}, { status: "joined", characterId: "pc_1" }), true)).toBe("can-edit");
    expect(panelMode(view({ locked: true }, { status: "joined", characterId: "pc_1" }), true)).toBe("sheet");
    expect(panelMode(view({ hasOtherCharacter: true }), true)).toBe("sheet");
    expect(panelMode(view({ settings: { abilityMethods: ["standard_array"], allowHomebrew: false, phoneCreation: false } }), false)).toBe("off");
    expect(panelMode(view({}, { status: "pending", characterId: "pc_1" }), true)).toBe("can-edit");
  });
});
