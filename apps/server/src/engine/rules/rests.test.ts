import { describe, expect, it } from "vitest";
import type { Character, GameState, Rng } from "@dm/shared";
import { executeEngineTool } from "../tools.js";
import { applyDerived } from "./derive.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./testing.js";

const ctx = rulesCtx();
const run = (s: GameState, name: Parameters<typeof executeEngineTool>[1], args: unknown, rng: Rng = seq(5)) =>
  executeEngineTool(s, name, args, rulesCtx(rng));
const derived = (c: Character) => applyDerived(c, ctx.classData(c.className));
type Row = Record<string, unknown>;
const rows = (o: unknown) => (o as { characters: Row[] }).characters;

// Fighter 5, CON 14 (+2): 5d10 hit dice.
const fighter = (over: Partial<Character> = {}) =>
  derived(makeCharacter({ id: "pc_f", name: "Thorin", className: "Fighter", level: 5, maxHp: 44, hp: 10, abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }, ...over }));
const barbarian = (over: Partial<Character> = {}) =>
  derived(makeCharacter({ id: "pc_b", name: "Grog", className: "Barbarian", level: 3, maxHp: 35, hp: 20, abilities: { str: 16, dex: 12, con: 6, int: 8, wis: 10, cha: 10 }, ...over }));
const warlock = (over: Partial<Character> = {}) =>
  derived(makeCharacter({ id: "pc_k", name: "Kel", className: "Warlock", level: 5, maxHp: 30, hp: 30, ...over }));
const wizard = (over: Partial<Character> = {}) =>
  derived(makeCharacter({ id: "pc_w", name: "Lyra", className: "Wizard", level: 5, maxHp: 27, hp: 27, ...over }));

function spendAll(c: Character) {
  for (const s of c.spellSlots) s.used = s.max;
  if (c.pactSlots) c.pactSlots.used = c.pactSlots.max;
  for (const r of c.resources) r.used = r.max;
  return c;
}

describe("short_rest", () => {
  it("spends Hit Dice: each die + CON mod, rolled and shown", () => {
    const { state, outcome } = run(stateWith(fighter()), "short_rest", { character_ids: ["pc_f"], hit_dice: { pc_f: 2 } }, seq(4, 7));
    const c = state.characters[0];
    expect(c.hp).toBe(10 + 6 + 9);
    expect(c.hitDice).toEqual({ die: 10, max: 5, used: 2 });
    expect(outcome.rolls.map((r) => [r.notation, r.total])).toEqual([
      ["1d10+2", 6],
      ["1d10+2", 9],
    ]);
    expect(rows(outcome.output)[0]).toMatchObject({ name: "Thorin", hit_dice_spent: 2, healed: 15, hp: "25/44", hit_dice_left: "3/5 d10" });
  });

  it("each die heals at least 1, HP caps at the maximum and dice stop being spent when full", () => {
    // CON 6 (-2): a roll of 1 gives 1, not -1.
    const low = run(stateWith(barbarian()), "short_rest", { character_ids: ["Grog"], hit_dice: { Grog: 1 } }, seq(1));
    expect(low.state.characters[0].hp).toBe(21);
    const full = run(stateWith(fighter({ hp: 40 })), "short_rest", { character_ids: ["pc_f"], hit_dice: { pc_f: 3 } }, seq(10));
    expect(full.state.characters[0].hp).toBe(44);
    expect(full.state.characters[0].hitDice.used).toBe(1);
    expect(full.outcome.rolls).toHaveLength(1);
  });

  it("cannot spend more Hit Dice than are left", () => {
    const c = fighter({ hitDice: { die: 10, max: 5, used: 4 } });
    const r = run(stateWith(c), "short_rest", { character_ids: ["pc_f"], hit_dice: { pc_f: 3 } }, seq(2));
    expect(r.state.characters[0].hitDice.used).toBe(5);
    expect(r.outcome.rolls).toHaveLength(1);
  });

  it("recovers Pact Magic slots and short-rest features; long-rest features regain their Short Rest share", () => {
    const s = stateWith(spendAll(warlock()), spendAll(fighter()), spendAll(barbarian()));
    const { state, outcome } = run(s, "short_rest", { character_ids: ["pc_k", "pc_f", "pc_b"] });
    const [k, f, b] = state.characters;
    expect(k.pactSlots?.used).toBe(0);
    const res = (c: Character, n: string) => c.resources.find((r) => r.name === n)!;
    expect(res(f, "Action Surge").used).toBe(0); // resetOn short
    expect(res(f, "Second Wind").used).toBe(res(f, "Second Wind").max - 1); // regain one
    expect(res(b, "Rage").used).toBe(res(b, "Rage").max - 1); // regain one
    expect(rows(outcome.output)[0]).toMatchObject({ recovered: expect.arrayContaining(["Pact Magic slots"]) });
  });

  it("does not restore regular spell slots, and reminds about Arcane Recovery", () => {
    const { state, outcome } = run(stateWith(spendAll(wizard()), fighter()), "short_rest", { character_ids: ["pc_w"] });
    expect(state.characters[0].spellSlots.every((s) => s.used === s.max)).toBe(true);
    expect(state.characters[0].resources[0].used).toBe(1); // Arcane Recovery is once per Long Rest
    const fresh = run(stateWith(wizard()), "short_rest", { character_ids: ["pc_w"] });
    expect(JSON.stringify(fresh.outcome.output)).toMatch(/Arcane Recovery/);
    expect(outcome.output).toBeDefined();
    expect(state.characters[1].hp).toBe(10); // not resting
  });

  it("a character at 0 HP can't take a Short Rest", () => {
    const r = run(stateWith(fighter({ hp: 0, conditions: ["Unconscious"] })), "short_rest", { character_ids: ["pc_f"], hit_dice: { pc_f: 2 } });
    expect(r.state.characters[0].hp).toBe(0);
    expect(rows(r.outcome.output)[0]).toMatchObject({ skipped: expect.stringMatching(/1 Hit Point/) });
  });
});

describe("long_rest", () => {
  it("restores the whole party by default: HP, all Hit Dice, slots, pact slots, features; clears temp HP and death saves", () => {
    const w = spendAll(wizard({ hp: 3, tempHp: 4, hitDice: { die: 6, max: 5, used: 5 }, concentration: { spell: "Detect Magic", since: 1 } }));
    const k = spendAll(warlock({ hp: 1 }));
    const f = spendAll(fighter({ hp: 5, deathSaves: { successes: 1, failures: 1, stable: false } }));
    const { state, outcome } = run(stateWith(w, k, f), "long_rest", {});
    const [w2, k2, f2] = state.characters;
    expect(w2).toMatchObject({ hp: 27, tempHp: 0, hitDice: { used: 0 }, concentration: null });
    expect(w2.spellSlots.every((s) => s.used === 0)).toBe(true);
    expect(k2.pactSlots?.used).toBe(0);
    expect(f2.resources.every((r) => r.used === 0)).toBe(true);
    expect(f2.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
    expect(rows(outcome.output)).toHaveLength(3);
  });

  it("only rests the listed characters, and skips anyone at 0 HP", () => {
    const s = stateWith(spendAll(wizard({ hp: 3 })), spendAll(fighter({ hp: 0, conditions: ["Unconscious"] })), spendAll(warlock({ hp: 2 })));
    const { state, outcome } = run(s, "long_rest", { character_ids: ["Lyra", "pc_f"] });
    expect(state.characters[0].hp).toBe(27);
    expect(state.characters[1].hp).toBe(0);
    expect(state.characters[1].resources.every((r) => r.used === r.max)).toBe(true);
    expect(state.characters[2].hp).toBe(2);
    expect(rows(outcome.output)[1]).toMatchObject({ skipped: expect.stringMatching(/1 Hit Point/) });
  });

  it("reduces Exhaustion by one level", () => {
    const s = stateWith(wizard({ conditions: ["Exhaustion 2", "Poisoned"] }), fighter({ conditions: ["Exhaustion"] }));
    const { state } = run(s, "long_rest", {});
    expect(state.characters[0].conditions).toEqual(["Exhaustion 1", "Poisoned"]);
    expect(state.characters[1].conditions).toEqual([]);
    const forms = run(stateWith(wizard({ conditions: ["Exhaustion: 2"] }), fighter({ conditions: ["Exhaustion (3)"] })), "long_rest", {}).state;
    expect(forms.characters[0].conditions).toEqual(["Exhaustion 1"]);
    expect(forms.characters[1].conditions).toEqual(["Exhaustion 2"]);
  });

  it("is pure", () => {
    const s = stateWith(spendAll(wizard({ hp: 3 })));
    const before = structuredClone(s);
    run(s, "long_rest", {});
    run(s, "short_rest", { character_ids: ["pc_w"], hit_dice: { pc_w: 1 } });
    run(s, "use_resource", { character_id: "pc_w", resource: "Arcane Recovery", amount: -1 });
    expect(s).toEqual(before);
  });
});

describe("use_resource", () => {
  it("spends uses by (prefix) name and refuses to overspend", () => {
    let s = stateWith(barbarian());
    const r = run(s, "use_resource", { character_id: "pc_b", resource: "rage" });
    s = r.state;
    expect(s.characters[0].resources.find((x) => x.name === "Rage")!.used).toBe(1);
    expect(r.outcome.output).toMatchObject({ name: "Grog", resource: "Rage", left: "2/3" });
    s = run(s, "use_resource", { character_id: "pc_b", resource: "Rage", amount: 2 }).state;
    expect(() => run(s, "use_resource", { character_id: "pc_b", resource: "Rage" })).toThrow(/no uses of Rage left/);
    s = run(s, "use_resource", { character_id: "pc_b", resource: "Rage", amount: -5 }).state;
    expect(s.characters[0].resources.find((x) => x.name === "Rage")!.used).toBe(0);
  });

  it("lists the character's resources when the name is unknown", () => {
    expect(() => run(stateWith(barbarian()), "use_resource", { character_id: "pc_b", resource: "Ki" })).toThrow(/Rage/);
  });
});
