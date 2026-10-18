import { describe, expect, it } from "vitest";
import type { Character, GameState, Rng } from "@dm/shared";
import { executeEngineTool } from "../tools.js";
import { applyDerived } from "./derive.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./testing.js";

const ctx = rulesCtx();
const run = (s: GameState, args: unknown, rng: Rng = seq(4)) => executeEngineTool(s, "level_up", args, rulesCtx(rng));
const derived = (c: Character) => applyDerived(c, ctx.classData(c.className));
type Out = Record<string, unknown> & { new_features?: { name: string; text: string }[] };

// Wizard 1, CON 12 (+1): 6 + 1 = 7 HP.
const wizard1 = (over: Partial<Character> = {}) =>
  derived(makeCharacter({ id: "pc_w", name: "Lyra", className: "Wizard", level: 1, maxHp: 7, hp: 7, abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 }, features: ["Spellcasting"], ...over }));

describe("level_up", () => {
  it("Wizard 1 → 2 → 3 (with subclass): HP, hit dice, slots, PB, features and subclass features", () => {
    let s = stateWith(wizard1());
    const r2 = run(s, { character_id: "Lyra", hp: "average" });
    s = r2.state;
    let c = s.characters[0];
    expect(c).toMatchObject({ level: 2, maxHp: 12, hp: 12, proficiencyBonus: 2, hitDice: { die: 6, max: 2, used: 0 } });
    expect(c.spellSlots).toEqual([{ level: 1, max: 3, used: 0 }]);
    const o2 = r2.outcome.output as Out;
    expect(o2).toMatchObject({ name: "Lyra", level: 2, hp_gain: 5 });
    expect(o2.new_features?.map((f) => f.name)).toEqual(["Scholar"]);
    expect(o2.new_features?.[0].text.length).toBeGreaterThan(20);
    expect(o2.new_features?.[0].text.length).toBeLessThanOrEqual(220);
    expect(c.features).toEqual(["Spellcasting", "Scholar"]);

    // Level 3 is the Wizard subclass level: refused without one, nothing changes.
    const refused = run(s, { character_id: "pc_w" });
    expect(refused.outcome.output).toMatchObject({ error: expect.stringMatching(/subclass/i), subclass_options: ["Evoker"] });
    expect(refused.state.characters[0].level).toBe(2);

    const r3 = run(s, { character_id: "pc_w", hp: "average", subclass: "Evocation" });
    c = r3.state.characters[0];
    expect(c).toMatchObject({ level: 3, subclass: "Evoker", maxHp: 17, hitDice: { max: 3 } });
    expect(c.spellSlots.map((x) => x.max)).toEqual([4, 2]);
    const names = (r3.outcome.output as Out).new_features!.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["Evocation Savant", "Potent Cantrip"]));
    expect(names.some((n) => /subclass/i.test(n))).toBe(false);
    expect(c.features).toEqual(expect.arrayContaining(["Scholar", "Evocation Savant", "Potent Cantrip"]));
  });

  it("rolls the Hit Die + CON mod when asked (minimum 1) and shows the roll", () => {
    const r = run(stateWith(wizard1()), { character_id: "pc_w", hp: "roll" }, seq(4));
    expect(r.outcome.rolls[0]).toMatchObject({ notation: "1d6+1", total: 5 });
    expect(r.state.characters[0].maxHp).toBe(12);
    const weak = run(stateWith(wizard1({ abilities: { str: 8, dex: 14, con: 3, int: 16, wis: 12, cha: 10 } })), { character_id: "pc_w", hp: "roll" }, seq(1));
    expect((weak.outcome.output as Out).hp_gain).toBe(1);
  });

  it("keeps spent slots, hit dice and resources (it is not a rest), and raises PB at level 5", () => {
    const c = derived(makeCharacter({ ...wizard1(), level: 4, maxHp: 22, hp: 10, subclass: "Evoker", hitDice: { die: 6, max: 4, used: 3 } }));
    c.spellSlots[0].used = 4;
    c.resources[0].used = 1;
    const r = run(stateWith(c), { character_id: "pc_w" });
    const n = r.state.characters[0];
    expect(n).toMatchObject({ level: 5, proficiencyBonus: 3, hp: 15, maxHp: 27, hitDice: { max: 5, used: 3 } });
    expect(n.spellSlots).toEqual([
      { level: 1, max: 4, used: 4 },
      { level: 2, max: 3, used: 0 },
      { level: 3, max: 2, used: 0 },
    ]);
    expect(n.resources[0].used).toBe(1);
    expect(r.outcome.output).toMatchObject({ slots: "1:0/4 2:3/3 3:2/2" });
  });

  it("adds new class resources (Fighter 2: Action Surge) and Warlock pact slot changes", () => {
    const f = derived(makeCharacter({ id: "pc_f", name: "Thorin", className: "Fighter", level: 1, maxHp: 12, hp: 12 }));
    const r = run(stateWith(f), { character_id: "pc_f" });
    expect(r.state.characters[0].resources.map((x) => x.name)).toEqual(["Second Wind", "Action Surge"]);
    expect((r.outcome.output as Out).new_features!.map((x) => x.name)).toEqual(expect.arrayContaining(["Action Surge", "Tactical Mind"]));
    const k = derived(makeCharacter({ id: "pc_k", name: "Kel", className: "Warlock", level: 4, subclass: "Fiend Patron", maxHp: 30, hp: 30 }));
    const k5 = run(stateWith(k), { character_id: "pc_k" }).state.characters[0];
    expect(k5.pactSlots).toEqual({ level: 3, max: 2, used: 0 });
  });

  it("accepts a subclass already on the sheet and adds later subclass features", () => {
    const c = derived(makeCharacter({ ...wizard1(), level: 5, maxHp: 27, hp: 27, subclass: "Evoker" }));
    const r = run(stateWith(c), { character_id: "pc_w" });
    expect((r.outcome.output as Out).new_features!.map((f) => f.name)).toContain("Sculpt Spells");
  });

  it("a non-SRD subclass is kept, without SRD subclass features", () => {
    const c = derived(makeCharacter({ ...wizard1(), level: 2, maxHp: 12, hp: 12 }));
    const r = run(stateWith(c), { character_id: "pc_w", subclass: "Chronurgy" });
    expect(r.state.characters[0].subclass).toBe("Chronurgy");
    expect(r.outcome.output).toMatchObject({ note: expect.stringMatching(/not the SRD subclass/) });
  });

  it("non-SRD classes level with a d8 and no features; level 20 is the cap", () => {
    const x = derived(makeCharacter({ id: "pc_x", name: "Tink", className: "Artificer", level: 3, maxHp: 20, hp: 20 }));
    const r = run(stateWith(x), { character_id: "pc_x" });
    expect(r.state.characters[0]).toMatchObject({ level: 4, maxHp: 25, hitDice: { die: 8, max: 4 } });
    expect(r.outcome.output).toMatchObject({ note: expect.stringMatching(/SRD/) });
    expect(run(stateWith(makeCharacter({ id: "pc_z", name: "Z", className: "Wizard", level: 20 })), { character_id: "pc_z" }).outcome.output).toMatchObject({
      error: expect.stringMatching(/20/),
    });
  });

  it("keeps hand-added resources (feats, magic items) through a level-up", () => {
    const f = derived(makeCharacter({ id: "pc_f", name: "Thorin", className: "Fighter", level: 1, maxHp: 12, hp: 12 }));
    f.resources.push({ name: "Luck Points", max: 3, used: 1, resetOn: "long" });
    const c = run(stateWith(f), { character_id: "pc_f" }).state.characters[0];
    expect(c.resources.find((r) => r.name === "Luck Points")).toEqual({ name: "Luck Points", max: 3, used: 1, resetOn: "long" });
    expect(c.resources.map((r) => r.name)).toEqual(["Second Wind", "Action Surge", "Luck Points"]);
  });

  it("a downed PC who gains HP from level_up wakes with fresh saves; a Dead PC can't level", () => {
    const f = derived(makeCharacter({ id: "pc_f", name: "Thorin", className: "Fighter", level: 1, maxHp: 12, hp: 0, conditions: ["Unconscious"], deathSaves: { successes: 1, failures: 2, stable: false } }));
    const c = run(stateWith(f), { character_id: "pc_f" }).state.characters[0];
    expect(c.hp).toBeGreaterThan(0);
    expect(c.conditions).not.toContain("Unconscious");
    expect(c.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
    const dead = run(stateWith({ ...f, conditions: ["Dead"] }), { character_id: "pc_f" });
    expect(dead.outcome.output).toMatchObject({ error: expect.stringMatching(/dead/i) });
    expect(dead.state.characters[0].level).toBe(1);
  });

  it("does not duplicate a feature gained at two levels (Ability Score Improvement at 4 and 8)", () => {
    let s = stateWith(derived(makeCharacter({ id: "pc_f", name: "Thorin", className: "Fighter", subclass: "Champion", level: 3, maxHp: 28, hp: 28 })));
    const outs: Out[] = [];
    for (let i = 0; i < 5; i++) {
      const r = run(s, { character_id: "pc_f" });
      outs.push(r.outcome.output as Out);
      s = r.state;
    }
    expect(s.characters[0].level).toBe(8);
    expect(s.characters[0].features.filter((f) => f === "Ability Score Improvement")).toHaveLength(1);
    expect(outs[4].new_features!.map((f) => f.name)).toContain("Ability Score Improvement");
  });

  it("is pure", () => {
    const s = stateWith(wizard1());
    const before = structuredClone(s);
    run(s, { character_id: "pc_w", hp: "roll" });
    expect(s).toEqual(before);
  });
});
