import { describe, expect, it } from "vitest";
import type { Character, GameState } from "@dm/shared";
import { executeEngineTool } from "../tools.js";
import { applyDerived } from "./derive.js";
import { spellLevelRows } from "./cast.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./testing.js";

const ctx = rulesCtx();
const run = (s: GameState, args: unknown) => executeEngineTool(s, "cast_spell", args, ctx);
type Out = Record<string, unknown>;

function derived(c: Character) {
  return applyDerived(c, ctx.classData(c.className));
}

// Wizard 5: INT 16 (+3), PB +3 -> spell save DC 14, spell attack +6. Slots [4,3,2].
const wizard = (over: Partial<Character> = {}) =>
  derived(
    makeCharacter({
      id: "pc_w",
      name: "Lyra",
      className: "Wizard",
      level: 5,
      proficiencyBonus: 3,
      abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
      spells: ["Fire Bolt", "Fireball", "Magic Missile", "Detect Magic", "Shield"],
      ...over,
    }),
  );
// Warlock 5: CHA 16 (+3), PB +3. Two pact slots at level 3.
const warlock = (over: Partial<Character> = {}) =>
  derived(
    makeCharacter({
      id: "pc_k",
      name: "Kel",
      className: "Warlock",
      level: 5,
      proficiencyBonus: 3,
      abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 16 },
      spells: ["Hex", "Eldritch Blast"],
      ...over,
    }),
  );
const slot = (c: Character, level: number) => c.spellSlots.find((s) => s.level === level)!;

describe("cast_spell", () => {
  it("Wizard 5 casts Fireball at level 3: spends a level 3 slot, DEX save DC 14, 8d6 fire, 20-ft sphere", () => {
    const s = stateWith(wizard());
    s.monsters.push({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13, initiativeBonus: 0, speed: 30, attacksPerAction: 1, attacks: [], conditions: [], hidden: false, npc: false, appearance: "", ally: false, follows: false, combatant: true, neutral: false, conditionMeta: [] });
    const { state, outcome } = run(s, { caster_id: "Lyra", spell: "fireball", target_ids: ["Goblin"], x: 5, y: 4 });
    expect(slot(state.characters[0], 3).used).toBe(1);
    expect(slot(state.characters[0], 1).used).toBe(0);
    expect(outcome.output).toMatchObject({
      caster: "Lyra",
      spell: "Fireball",
      level: 3,
      cast_level: 3,
      spent: "level 3 slot",
      save: { ability: "DEX", dc: 14 },
      damage: [{ dice: "8d6", type: "fire" }],
      area: { shape: "sphere", sizeFt: 20 },
      range: "150 feet",
      targets: ["Goblin"],
      slots_left: "1:4/4 2:3/3 3:1/2",
    });
    expect((outcome.output as Out).not_on_sheet).toBeUndefined();
    // Hook for spell animations.
    expect(outcome.cast).toMatchObject({ casterId: "pc_w", castLevel: 3, targetIds: ["m1"], x: 5, y: 4 });
    expect(outcome.cast?.spell.name).toBe("Fireball");
  });

  it("Fireball upcast at 5 needs and spends a level 5 slot: 10d6", () => {
    const w9 = derived(makeCharacter({ ...wizard(), level: 9, spellSlots: [], hitDice: { die: 6, max: 0, used: 0 } }));
    const { state, outcome } = run(stateWith(w9), { caster_id: "pc_w", spell: "Fireball", slot_level: 5 });
    expect(slot(state.characters[0], 5).used).toBe(1);
    expect(outcome.output).toMatchObject({ cast_level: 5, damage: [{ dice: "10d6", type: "fire" }] });
    // A Wizard 5 has no level 5 slot: error, nothing spent, free slot levels listed.
    const r = run(stateWith(wizard()), { caster_id: "pc_w", spell: "Fireball", slot_level: 5 });
    expect(r.outcome.output).toMatchObject({ error: expect.stringMatching(/level 5/), free_slots: [3] });
    expect(r.state.characters[0].spellSlots).toEqual(wizard().spellSlots);
  });

  it("uses exactly the requested level; when it is spent the error lists the free slot levels", () => {
    const c = wizard();
    slot(c, 3).used = 2;
    const r = run(stateWith(c), { caster_id: "pc_w", spell: "Fireball" });
    expect(r.outcome.output).toMatchObject({ error: expect.stringMatching(/no level 3 slot/i), free_slots: [] });
    const mm = run(stateWith(c), { caster_id: "pc_w", spell: "Magic Missile", slot_level: 2 });
    expect(mm.outcome.output).toMatchObject({ cast_level: 2, projectiles: 4, damage: [{ dice: "1d4+1", type: "force" }] });
    expect(slot(mm.state.characters[0], 2).used).toBe(1);
    expect(run(stateWith(c), { caster_id: "pc_w", spell: "Fireball", slot_level: 2 }).outcome.output).toMatchObject({ error: expect.stringMatching(/level 3 spell/) });
  });

  it("cantrips are free and scale with character level (Fire Bolt 2d10 at 5), with the spell attack bonus", () => {
    const { state, outcome } = run(stateWith(wizard()), { caster_id: "pc_w", spell: "Fire Bolt" });
    expect(state.characters[0].spellSlots).toEqual(wizard().spellSlots);
    expect(outcome.output).toMatchObject({ level: 0, cast_level: 0, spent: "cantrip (free)", attack_bonus: "+6", damage: [{ dice: "2d10", type: "fire" }] });
    expect(run(stateWith(wizard({ level: 4 })), { caster_id: "pc_w", spell: "Fire Bolt" }).outcome.output).toMatchObject({ damage: [{ dice: "1d10" }] });
  });

  it("rituals are free only when cast as a ritual", () => {
    const ritual = run(stateWith(wizard()), { caster_id: "pc_w", spell: "Detect Magic", as_ritual: true });
    expect(ritual.state.characters[0].spellSlots).toEqual(wizard().spellSlots);
    expect(ritual.outcome.output).toMatchObject({ spent: "ritual (free, +10 minutes)", concentration: true });
    const normal = run(stateWith(wizard()), { caster_id: "pc_w", spell: "Detect Magic" });
    expect(slot(normal.state.characters[0], 1).used).toBe(1);
    expect(run(stateWith(wizard()), { caster_id: "pc_w", spell: "Fireball", as_ritual: true }).outcome.output).toMatchObject({ error: expect.stringMatching(/Ritual/) });
    expect(run(stateWith(wizard()), { caster_id: "pc_w", spell: "Detect Magic", as_ritual: true, slot_level: 2 }).outcome.output).toMatchObject({ error: expect.stringMatching(/higher level/) });
  });

  it("a concentration spell replaces the current one and says which ended", () => {
    const c = wizard({ concentration: { spell: "Detect Magic", since: 1 } });
    const r = executeEngineTool(stateWith(c), "cast_spell", { caster_id: "pc_w", spell: "Hold Person" }, ctx);
    expect(r.state.characters[0].concentration?.spell).toBe("Hold Person");
    expect(r.outcome.output).toMatchObject({ concentration: true, ended_concentration: "Detect Magic", not_on_sheet: true });
    // A non-concentration spell leaves it alone.
    const f = run(stateWith(c), { caster_id: "pc_w", spell: "Fireball" });
    expect(f.state.characters[0].concentration?.spell).toBe("Detect Magic");
  });

  it("unknown or ambiguous spells return did_you_mean and spend nothing", () => {
    const s = stateWith(wizard());
    const r = run(s, { caster_id: "pc_w", spell: "Fire" });
    expect(r.outcome.output).toMatchObject({ error: expect.stringMatching(/Fire/), did_you_mean: expect.arrayContaining(["Fire Bolt", "Fireball"]) });
    expect(r.state.characters).toEqual(s.characters);
    expect(r.outcome.cast).toBeUndefined();
    expect(run(s, { caster_id: "pc_w", spell: "Zorblax's Wiggle" }).outcome.output).toMatchObject({ error: expect.any(String) });
  });

  it("heal spells report dice plus the spellcasting modifier", () => {
    const cleric = derived(makeCharacter({ id: "pc_c", name: "Mira", className: "Cleric", level: 3, abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 }, spells: ["Cure Wounds"] }));
    const r = run(stateWith(cleric), { caster_id: "pc_c", spell: "Cure Wounds", slot_level: 2 });
    expect(r.outcome.output).toMatchObject({ heal: "4d8+3", cast_level: 2 });
  });

  it("reports later damage separately from the primary damage (Acid Arrow)", () => {
    const r = run(stateWith(wizard()), { caster_id: "pc_w", spell: "Acid Arrow" });
    expect(r.outcome.output).toMatchObject({ damage: [{ dice: "4d4", type: "acid" }], later_damage: [{ dice: "2d4", type: "acid" }], attack_bonus: "+6" });
  });

  it("refuses a caster who is down", () => {
    const r = run(stateWith(wizard({ hp: 0, conditions: ["Unconscious"] })), { caster_id: "pc_w", spell: "Fire Bolt" });
    expect(r.outcome.output).toMatchObject({ error: expect.stringMatching(/can't cast/) });
  });

  it("warns (does not refuse) on a second slot spell by the same caster in the same combat turn", () => {
    const s = stateWith(wizard());
    s.combat = { active: true, round: 1, turnIndex: 0, order: [{ entityId: "pc_w", entityType: "character", name: "Lyra", initiative: 15 }], turn: null, reactionsUsed: [] };
    const once = run(s, { caster_id: "pc_w", spell: "Shield" });
    expect((once.outcome.output as Out).warning).toBeUndefined();
    const twice = run(once.state, { caster_id: "pc_w", spell: "Magic Missile" });
    expect(twice.outcome.output).toMatchObject({ warning: expect.stringMatching(/only one spell slot/) });
    expect(slot(twice.state.characters[0], 1).used).toBe(2);
    // A cantrip is fine, and a new turn (or a new combat) starts fresh.
    expect((run(once.state, { caster_id: "pc_w", spell: "Fire Bolt" }).outcome.output as Out).warning).toBeUndefined();
    const next = structuredClone(once.state);
    next.combat.round = 2;
    expect((run(next, { caster_id: "pc_w", spell: "Magic Missile" }).outcome.output as Out).warning).toBeUndefined();
    const restarted = executeEngineTool(once.state, "start_combat", {}, ctx).state;
    restarted.combat.turnIndex = 0;
    restarted.combat.round = 1;
    expect((run(restarted, { caster_id: "pc_w", spell: "Magic Missile" }).outcome.output as Out).warning).toBeUndefined();
    // Outside combat there is no turn to count.
    const free = run(stateWith(wizard()), { caster_id: "pc_w", spell: "Shield" }).state;
    expect((run(free, { caster_id: "pc_w", spell: "Magic Missile" }).outcome.output as Out).warning).toBeUndefined();
  });

  it("a revival spell on a dead target hints to call revive, without reviving", () => {
    const cleric = derived(makeCharacter({ id: "pc_c", name: "Mira", className: "Cleric", level: 5, abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 }, spells: ["Revivify"] }));
    const deadPc = makeCharacter({ id: "pc_d", name: "Dan", hp: 0, conditions: ["Dead"] });
    const r = run(stateWith(cleric, deadPc), { caster_id: "pc_c", spell: "Revivify", target_ids: ["Dan"] });
    expect(r.outcome.output).toMatchObject({ hint: expect.stringMatching(/revive/) });
    expect(r.state.characters[1].conditions).toContain("Dead");
    expect((run(stateWith(cleric, makeCharacter({ id: "pc_d", name: "Dan" })), { caster_id: "pc_c", spell: "Revivify", target_ids: ["Dan"] }).outcome.output as Out).hint).toBeUndefined();
  });

  it("is pure", () => {
    const s = stateWith(wizard({ concentration: { spell: "Detect Magic", since: 1 } }));
    const before = structuredClone(s);
    run(s, { caster_id: "pc_w", spell: "Fireball" });
    run(s, { caster_id: "pc_w", spell: "Hold Person" });
    expect(s).toEqual(before);
  });
});

describe("cast_spell: Warlock Pact Magic", () => {
  it("spends a pact slot and casts at the pact slot level (Hex at 3)", () => {
    const { state, outcome } = run(stateWith(warlock()), { caster_id: "pc_k", spell: "Hex" });
    expect(state.characters[0].pactSlots).toEqual({ level: 3, max: 2, used: 1 });
    expect(outcome.output).toMatchObject({ spent: "pact slot (level 3)", cast_level: 3, pact_left: "L3 1/2", concentration: true });
    expect(state.characters[0].concentration?.spell).toBe("Hex");
  });

  it("errors when the pact slots are spent and when the spell is above the pact slot level", () => {
    const c = warlock();
    c.pactSlots!.used = 2;
    expect(run(stateWith(c), { caster_id: "pc_k", spell: "Hex" }).outcome.output).toMatchObject({ error: expect.stringMatching(/Short Rest/) });
    expect(run(stateWith(warlock()), { caster_id: "pc_k", spell: "Hex", slot_level: 4 }).outcome.output).toMatchObject({ error: expect.any(String) });
  });

  it("Eldritch Blast is a free cantrip with CHA attack bonus", () => {
    const r = run(stateWith(warlock()), { caster_id: "pc_k", spell: "Eldritch Blast" });
    expect(r.state.characters[0].pactSlots?.used).toBe(0);
    expect(r.outcome.output).toMatchObject({ attack_bonus: "+6", projectiles: 2 });
  });

  it("level 6+ spells use a Mystic Arcanum use", () => {
    const k = derived(makeCharacter({ ...warlock(), level: 11, hitDice: { die: 8, max: 0, used: 0 } }));
    const r = run(stateWith(k), { caster_id: "pc_k", spell: "Circle of Death" });
    expect(r.outcome.output).toMatchObject({ spent: "Mystic Arcanum (level 6)", cast_level: 6, save: { ability: "CON" } });
    expect(r.state.characters[0].resources.find((x) => x.name === "Mystic Arcanum (level 6)")?.used).toBe(1);
    expect(r.state.characters[0].pactSlots?.used).toBe(0);
    expect(run(r.state, { caster_id: "pc_k", spell: "Circle of Death" }).outcome.output).toMatchObject({ error: expect.stringMatching(/Long Rest/) });
    const hi = run(stateWith(k), { caster_id: "pc_k", spell: "Circle of Death", slot_level: 8 });
    expect(hi.outcome.output).toMatchObject({ cast_level: 6, warning: expect.stringMatching(/own level/) });
  });
});

describe("cast_spell then rest", () => {
  it("a short rest gives the Warlock its pact slots back (seq rng unused)", () => {
    let s = run(stateWith(warlock()), { caster_id: "pc_k", spell: "Hex" }).state;
    s = executeEngineTool(s, "short_rest", { character_ids: ["pc_k"] }, rulesCtx(seq(4))).state;
    expect(s.characters[0].pactSlots?.used).toBe(0);
  });
});

describe("spellLevelRows (phone spell card)", () => {
  const rows = (c: Character, name: string) => spellLevelRows(c, ctx.spell(name)!, ctx);

  it("Magic Missile: one more dart per slot level, up to the highest slot; levels with slots left marked", () => {
    const c = wizard();
    c.spellSlots = c.spellSlots.map((s) => (s.level === 2 ? { ...s, used: s.max } : s));
    expect(rows(c, "Magic Missile")).toEqual([
      { level: 1, damage: "3× 1d4+1 Force", available: true },
      { level: 2, damage: "4× 1d4+1 Force", available: false },
      { level: 3, damage: "5× 1d4+1 Force", available: true },
    ]);
  });

  it("Fireball from its own level only; a spell without damage or healing has no rows", () => {
    expect(rows(wizard(), "Fireball")).toEqual([{ level: 3, damage: "8d6 Fire", available: true }]);
    expect(rows(wizard(), "Shield")).toEqual([]);
  });

  it("cantrips: one row at the character level", () => {
    expect(rows(wizard(), "Fire Bolt")).toEqual([{ level: 0, damage: "2d10 Fire", available: true }]);
  });

  it("healing adds the spellcasting modifier; pact slots count", () => {
    const w = warlock({ spells: ["Hellish Rebuke", "Cure Wounds"] });
    const r = rows(w, "Cure Wounds");
    expect(r.map((x) => x.level)).toEqual([1, 2, 3]);
    expect(r[0].heal).toBe("2d8+3");
    expect(r[2]).toMatchObject({ heal: "6d8+3", available: true });
    expect(r[0].available).toBe(false);
  });
});
