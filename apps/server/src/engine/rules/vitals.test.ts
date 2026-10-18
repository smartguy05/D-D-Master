import { describe, expect, it } from "vitest";
import type { GameState } from "@dm/shared";
import { executeEngineTool } from "../tools.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./testing.js";

const run = (s: GameState, name: Parameters<typeof executeEngineTool>[1], args: unknown, rng = seq(10)) =>
  executeEngineTool(s, name, args, rulesCtx(rng));

const fighter = (over = {}) =>
  makeCharacter({ id: "pc_f", name: "Thorin", className: "Fighter", maxHp: 12, hp: 12, abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }, ...over });
const cleric = (over = {}) =>
  makeCharacter({
    id: "pc_c",
    name: "Mira",
    className: "Cleric",
    level: 3,
    maxHp: 20,
    hp: 20,
    proficiencyBonus: 2,
    abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
    concentration: { spell: "Bless", since: 1 },
    ...over,
  });
const downed = (over = {}) => fighter({ hp: 0, conditions: ["Unconscious"], ...over });

describe("dropping to 0 HP", () => {
  it("a character falls Unconscious with fresh death saves", () => {
    const { state, outcome } = run(stateWith(fighter({ deathSaves: { successes: 2, failures: 1, stable: false } })), "apply_damage", { target_id: "pc_f", amount: 15 });
    const c = state.characters[0];
    expect(c.hp).toBe(0);
    expect(c.conditions).toContain("Unconscious");
    expect(c.conditions).not.toContain("Dead");
    expect(c.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
    expect(outcome.output).toMatchObject({ hp: 0, down: true });
  });

  it("massive damage: the remainder after 0 HP equal to the HP maximum kills outright (SRD example)", () => {
    // HP max 12, 6 HP, 18 damage: 12 remains -> dies.
    const { state, outcome } = run(stateWith(fighter({ hp: 6 })), "apply_damage", { target_id: "pc_f", amount: 18 });
    expect(state.characters[0].conditions).toContain("Dead");
    expect(state.characters[0].conditions).not.toContain("Unconscious");
    expect(outcome.output).toMatchObject({ dead: true, cause: "massive damage" });
    // 17 damage leaves 11 < 12: only unconscious.
    const ok = run(stateWith(fighter({ hp: 6 })), "apply_damage", { target_id: "pc_f", amount: 17 }).state.characters[0];
    expect(ok.conditions).toEqual(["Unconscious"]);
  });

  it("temp HP absorbs first, so massive damage counts only what reaches HP", () => {
    const s = stateWith(fighter({ hp: 6, tempHp: 5 }));
    const c = run(s, "apply_damage", { target_id: "pc_f", amount: 18 }).state.characters[0];
    expect(c.conditions).toEqual(["Unconscious"]);
  });

  it("monsters still just die at 0 HP", () => {
    const s = stateWith();
    s.monsters.push({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13, initiativeBonus: 0, attacks: [], conditions: [], hidden: false });
    expect(run(s, "apply_damage", { target_id: "m1", amount: 9 }).state.monsters[0].conditions).toEqual(["Dead"]);
  });
});

describe("damage at 0 HP", () => {
  it("adds one failure, two for a critical hit, and three failures mean death", () => {
    let s = stateWith(downed());
    s = run(s, "apply_damage", { target_id: "pc_f", amount: 3 }).state;
    expect(s.characters[0].deathSaves.failures).toBe(1);
    const crit = run(s, "apply_damage", { target_id: "pc_f", amount: 3, critical: true });
    expect(crit.state.characters[0].deathSaves.failures).toBe(3);
    expect(crit.state.characters[0].conditions).toContain("Dead");
    expect(crit.outcome.output).toMatchObject({ dead: true, cause: "three failed death saves" });
  });

  it("damage equal to the HP maximum while at 0 HP kills", () => {
    const r = run(stateWith(downed()), "apply_damage", { target_id: "pc_f", amount: 12 });
    expect(r.state.characters[0].conditions).toContain("Dead");
    expect(r.outcome.output).toMatchObject({ dead: true, cause: "massive damage" });
  });

  it("a Stable creature that takes damage stops being Stable", () => {
    const s = stateWith(downed({ deathSaves: { successes: 0, failures: 0, stable: true } }));
    const c = run(s, "apply_damage", { target_id: "pc_f", amount: 1 }).state.characters[0];
    expect(c.deathSaves).toEqual({ successes: 0, failures: 1, stable: false });
  });

  it("damage to a dead character changes nothing", () => {
    const s = stateWith(downed({ conditions: ["Dead"], deathSaves: { successes: 0, failures: 3, stable: false } }));
    const c = run(s, "apply_damage", { target_id: "pc_f", amount: 4 }).state.characters[0];
    expect(c.deathSaves.failures).toBe(3);
    expect(c.conditions).toEqual(["Dead"]);
  });
});

describe("death_save", () => {
  it("rolls a virtual d20: 10+ is a success, below is a failure", () => {
    let r = run(stateWith(downed()), "death_save", { character_id: "pc_f" }, seq(10));
    expect(r.outcome.rolls).toHaveLength(1);
    expect(r.outcome.rolls[0]).toMatchObject({ notation: "1d20", dc: 10, success: true, rollerId: "pc_f" });
    expect(r.state.characters[0].deathSaves).toMatchObject({ successes: 1, failures: 0 });
    r = run(r.state, "death_save", { character_id: "pc_f" }, seq(9));
    expect(r.state.characters[0].deathSaves).toMatchObject({ successes: 1, failures: 1 });
  });

  it("three successes: Stable (counts reset), still Unconscious at 0 HP", () => {
    let s = stateWith(downed({ deathSaves: { successes: 2, failures: 2, stable: false } }));
    const r = run(s, "death_save", { character_id: "pc_f" }, seq(15));
    s = r.state;
    expect(s.characters[0].deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
    expect(s.characters[0].conditions).toContain("Unconscious");
    expect(s.characters[0].hp).toBe(0);
    expect(r.outcome.output).toMatchObject({ stable: true });
    expect(run(s, "death_save", { character_id: "pc_f" }).outcome.output).toMatchObject({ stable: true, rolled: false });
  });

  it("a natural 20 brings the character back with 1 HP, conscious, saves reset", () => {
    const r = run(stateWith(downed({ deathSaves: { successes: 0, failures: 2, stable: false } })), "death_save", { character_id: "pc_f" }, seq(20));
    const c = r.state.characters[0];
    expect(c.hp).toBe(1);
    expect(c.conditions).not.toContain("Unconscious");
    expect(c.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
  });

  it("a natural 1 counts as two failures", () => {
    const r = run(stateWith(downed({ deathSaves: { successes: 2, failures: 1, stable: false } })), "death_save", { character_id: "pc_f" }, seq(1));
    expect(r.state.characters[0].deathSaves.failures).toBe(3);
    expect(r.state.characters[0].conditions).toContain("Dead");
  });

  it("physical dice: sets a death_save pending roll that record_physical_roll applies", () => {
    let s = stateWith(downed({ diceMode: "physical" }));
    const r = run(s, "death_save", { character_id: "pc_f" });
    expect(r.outcome.rolls).toHaveLength(0);
    expect(r.state.pendingRoll).toMatchObject({ characterId: "pc_f", notation: "1d20", dc: 10, kind: "death_save" });
    s = run(r.state, "record_physical_roll", { character_id: "pc_f", notation: "1d20", label: "Death saving throw", total: 20 }).state;
    expect(s.pendingRoll).toBeUndefined();
    expect(s.characters[0].hp).toBe(1);
    expect(() => run(stateWith(downed({ diceMode: "physical" })), "record_physical_roll", { character_id: "pc_f", notation: "1d20", label: "x", total: 23, kind: "death_save" })).toThrow(/1 to 20/);
  });

  it("refuses for conscious or dead characters", () => {
    expect(() => run(stateWith(fighter()), "death_save", { character_id: "pc_f" })).toThrow(/0 HP/);
    expect(() => run(stateWith(downed({ conditions: ["Dead"] })), "death_save", { character_id: "pc_f" })).toThrow(/dead/);
  });
});

describe("healing and stabilize", () => {
  it("any healing resets the death saves and wakes the character", () => {
    const s = stateWith(downed({ deathSaves: { successes: 1, failures: 2, stable: false } }));
    const c = run(s, "heal", { target_id: "pc_f", amount: 3 }).state.characters[0];
    expect(c.hp).toBe(3);
    expect(c.conditions).not.toContain("Unconscious");
    expect(c.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
  });

  it("stabilize makes a dying character Stable with saves reset", () => {
    const r = run(stateWith(downed({ deathSaves: { successes: 1, failures: 2, stable: false } })), "stabilize", { character_id: "Thorin" });
    expect(r.state.characters[0].deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
    expect(r.state.characters[0].conditions).toContain("Unconscious");
    expect(() => run(stateWith(fighter()), "stabilize", { character_id: "pc_f" })).toThrow(/0 HP/);
  });
});

describe("next_turn and death saves", () => {
  function combat(...chars: ReturnType<typeof fighter>[]) {
    const s = stateWith(...chars);
    s.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      order: chars.map((c, i) => ({ entityId: c.id, entityType: "character" as const, name: c.name, initiative: 20 - i })),
    };
    return s;
  }

  it("landing on a downed, unstable PC rolls its death save (virtual)", () => {
    const s = combat(cleric({ concentration: null }), downed());
    const r = run(s, "next_turn", {}, seq(4));
    expect(r.outcome.output).toMatchObject({ current: "Thorin", death_save: { roll: 4, success: false, failures: 1 } });
    expect(r.outcome.rolls).toHaveLength(1);
    expect(r.state.characters[1].deathSaves.failures).toBe(1);
  });

  it("asks for physical dice, skips Stable PCs and skips the dead", () => {
    const phys = run(combat(cleric({ concentration: null }), downed({ diceMode: "physical" })), "next_turn", {});
    expect(phys.state.pendingRoll).toMatchObject({ characterId: "pc_f", kind: "death_save" });
    const stable = run(combat(cleric({ concentration: null }), downed({ deathSaves: { successes: 0, failures: 0, stable: true } })), "next_turn", {});
    expect(stable.outcome.rolls).toHaveLength(0);
    expect((stable.outcome.output as { death_save?: unknown }).death_save).toBeUndefined();
    const dead = run(combat(cleric({ concentration: null }), downed({ id: "pc_d", name: "Dead Dan", conditions: ["Dead"] }), fighter()), "next_turn", {});
    expect(dead.outcome.output).toMatchObject({ current: "Thorin" });
  });

  it("start_combat keeps downed (not dead) PCs in the initiative order", () => {
    const s = stateWith(fighter(), downed({ id: "pc_x", name: "Pip" }), downed({ id: "pc_d", name: "Dan", conditions: ["Dead"] }));
    const order = run(s, "start_combat", {}).state.combat.order.map((o) => o.name);
    expect(order).toEqual(expect.arrayContaining(["Thorin", "Pip"]));
    expect(order).not.toContain("Dan");
  });
});

describe("concentration", () => {
  it("damage asks for a CON save at DC max(10, half damage) and a failure ends concentration (virtual)", () => {
    // CON 14 -> +2. Roll 7 + 2 = 9 < DC 10: concentration lost.
    const r = run(stateWith(cleric()), "apply_damage", { target_id: "pc_c", amount: 5 }, seq(7));
    expect(r.outcome.rolls[0]).toMatchObject({ notation: "1d20+2", dc: 10, success: false });
    expect(r.state.characters[0].concentration).toBeNull();
    expect(r.outcome.output).toMatchObject({ concentration: { spell: "Bless", dc: 10, kept: false } });
    // Roll 8 + 2 = 10: kept.
    const kept = run(stateWith(cleric()), "apply_damage", { target_id: "pc_c", amount: 5 }, seq(8));
    expect(kept.state.characters[0].concentration?.spell).toBe("Bless");
  });

  it("the DC is half the damage when higher, capped at 30, and CON save proficiency adds PB", () => {
    const r = run(stateWith(cleric({ maxHp: 200, hp: 200, savingThrows: ["Constitution"] })), "apply_damage", { target_id: "pc_c", amount: 25 }, seq(10));
    expect(r.outcome.rolls[0]).toMatchObject({ notation: "1d20+4", dc: 12 });
    const big = run(stateWith(cleric({ maxHp: 200, hp: 200 })), "apply_damage", { target_id: "pc_c", amount: 99 }, seq(10));
    expect(big.outcome.rolls[0].dc).toBe(30);
  });

  it("uses the class's saving throw proficiencies when the sheet lists none (Sorcerer: CON)", () => {
    const sorc = cleric({ className: "Sorcerer", savingThrows: [] });
    expect(run(stateWith(sorc), "apply_damage", { target_id: "pc_c", amount: 2 }, seq(10)).outcome.rolls[0].notation).toBe("1d20+4");
  });

  it("physical dice: a concentration pending roll, applied by record_physical_roll", () => {
    let s = run(stateWith(cleric({ diceMode: "physical" })), "apply_damage", { target_id: "pc_c", amount: 4 }).state;
    expect(s.pendingRoll).toMatchObject({ characterId: "pc_c", kind: "concentration", dc: 10, notation: "1d20+2" });
    s = run(s, "record_physical_roll", { character_id: "pc_c", notation: "1d20+2", label: "Concentration", total: 9, dc: 10 }).state;
    expect(s.characters[0].concentration).toBeNull();
    expect(s.pendingRoll).toBeUndefined();
  });

  it("never overwrites another pending roll: it tells the DM to record it with kind instead", () => {
    const s = stateWith(cleric({ diceMode: "physical" }), fighter({ diceMode: "physical" }));
    s.pendingRoll = { characterId: "pc_f", notation: "1d20+3", label: "Stealth", kind: "check" };
    const r = run(s, "apply_damage", { target_id: "pc_c", amount: 4 });
    expect(r.state.pendingRoll).toMatchObject({ characterId: "pc_f", label: "Stealth" });
    expect(JSON.stringify(r.outcome.output)).toMatch(/kind=concentration/);
    const rec = run(r.state, "record_physical_roll", { character_id: "pc_c", notation: "1d20+2", label: "Concentration", total: 4, dc: 10, kind: "concentration" });
    expect(rec.state.characters[0].concentration).toBeNull();
    expect(rec.state.pendingRoll).toMatchObject({ characterId: "pc_f" }); // someone else's prompt stays
  });

  it("request_player_roll replacing an automatic pending roll warns the DM", () => {
    const s = stateWith(downed({ diceMode: "physical" }));
    s.pendingRoll = { characterId: "pc_f", notation: "1d20", label: "Death saving throw", dc: 10, kind: "death_save" };
    const r = run(s, "request_player_roll", { character_id: "pc_f", notation: "1d20", label: "Perception" });
    expect(r.outcome.output).toMatchObject({ replaced: expect.stringMatching(/death save/i) });
  });

  it("dropping to 0 HP, Unconscious or Incapacitated ends concentration without a save", () => {
    const r = run(stateWith(cleric()), "apply_damage", { target_id: "pc_c", amount: 25 });
    expect(r.outcome.rolls).toHaveLength(0);
    expect(r.state.characters[0].concentration).toBeNull();
    for (const cond of ["Unconscious", "incapacitated", "Stunned", "Paralyzed", "Petrified"]) {
      expect(run(stateWith(cleric()), "add_condition", { target_id: "pc_c", condition: cond }).state.characters[0].concentration).toBeNull();
    }
    expect(run(stateWith(cleric()), "add_condition", { target_id: "pc_c", condition: "Prone" }).state.characters[0].concentration).not.toBeNull();
  });

  it("end_concentration clears it and says which spell ended", () => {
    const r = run(stateWith(cleric()), "end_concentration", { character_id: "pc_c" });
    expect(r.state.characters[0].concentration).toBeNull();
    expect(r.outcome.output).toMatchObject({ ended: "Bless" });
    expect(run(r.state, "end_concentration", { character_id: "pc_c" }).outcome.output).toMatchObject({ ended: null });
  });
});

describe("purity", () => {
  it("rules hooks never mutate the input state", () => {
    const s = stateWith(cleric(), downed());
    const before = structuredClone(s);
    run(s, "apply_damage", { target_id: "pc_c", amount: 30 });
    run(s, "apply_damage", { target_id: "pc_f", amount: 2, critical: true });
    run(s, "death_save", { character_id: "pc_f" }, seq(20));
    run(s, "stabilize", { character_id: "pc_f" });
    run(s, "heal", { target_id: "pc_f", amount: 2 });
    expect(s).toEqual(before);
  });
});
