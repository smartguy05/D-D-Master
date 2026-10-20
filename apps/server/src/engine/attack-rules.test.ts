import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState, Monster } from "@dm/shared";
import { executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./rules/testing.js";

// Edge cases of the AC default, spell-attack allowance and already_recorded guard (from the
// adversarial review of the 2026-10-19 test-run fixes).

type Out = Record<string, unknown> & { error?: string };

const goblin = (over: Partial<Monster> = {}): Monster => ({
  id: "m1",
  name: "Goblin",
  maxHp: 7,
  hp: 7,
  ac: 13,
  initiativeBonus: 0,
  speed: 30,
  attacksPerAction: 1,
  attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2" }],
  conditions: [],
  hidden: false,
  npc: false,
  appearance: "",
  ally: false,
  follows: false,
  combatant: true,
  neutral: false,
  conditionMeta: [],
  ...over,
});

function party(monster: Partial<Monster> = {}): GameState {
  const s = stateWith(
    makeCharacter({ id: "pc_f", name: "Thorin", ac: 16 }),
    makeCharacter({ id: "pc_l", name: "Lyra", ac: 12, diceMode: "physical" }),
  );
  s.monsters.push(goblin(monster));
  return s;
}

function inCombat(order: string[], ...chars: ReturnType<typeof makeCharacter>[]): GameState {
  const s = stateWith(...chars);
  s.monsters.push(goblin());
  const all = [...s.characters.map((c) => ({ id: c.id, name: c.name, type: "character" as const })), ...s.monsters.map((m) => ({ id: m.id, name: m.name, type: "monster" as const }))];
  all.forEach((e, i) => s.tokens.push({ id: `tok_${e.id}`, entityId: e.id, entityType: e.type, x: 2 + i * 3, y: 2, size: 1 }));
  s.combat = {
    active: true,
    round: 1,
    turnIndex: 0,
    order: order.map((id, i) => {
      const e = all.find((x) => x.id === id)!;
      return { entityId: e.id, entityType: e.type, name: e.name, initiative: 20 - i };
    }),
    turn: null,
    reactionsUsed: [],
  };
  return s;
}

function run(s: GameState, name: EngineTool, args: unknown, c: EngineContext = rulesCtx(seq(5))) {
  const r = executeEngineTool(s, name, args, c);
  return { state: r.state, out: r.outcome.output as Out, rolls: r.outcome.rolls, effects: r.outcome.effects };
}

const caster = (spells: string[]) =>
  makeCharacter({
    id: "pc_w",
    name: "Lyra",
    className: "Cleric",
    level: 5,
    abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 16, cha: 10 },
    spellSlots: [{ level: 1, max: 4, used: 0 }, { level: 2, max: 3, used: 0 }, { level: 3, max: 2, used: 0 }],
    spells,
  });

describe("AC default honours natural 20 / natural 1 (SRD: a 20 always hits, a 1 always misses)", () => {
  it("roll_dice: a natural 20 against a higher AC is a hit", () => {
    const r = run(party({ ac: 25 }), "roll_dice", { notation: "1d20+2", label: "attack", roller_id: "pc_f", target_id: "m1" }, rulesCtx(seq(20)));
    expect(r.out.natural20).toBe(true);
    expect(r.out.success).toBe(true);
    expect(r.rolls[0].success).toBe(true);
  });

  it("roll_dice: a natural 1 is a miss even when the total beats the AC", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+15", label: "attack", roller_id: "pc_f", target_id: "m1" }, rulesCtx(seq(1)));
    expect(r.out.natural1).toBe(true);
    expect(r.out.success).toBe(false); // the TV toast shows "success" while the attack effect shows a miss
  });

  it("record_physical_roll: a spoken natural 20 against the pending AC is a hit", () => {
    const s = run(party({ ac: 25 }), "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }).state;
    const r = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 24, natural: 20 });
    expect(r.out.success).toBe(true);
  });
});

describe("AC default only for attacks", () => {
  it("a creature rolling with itself as target (its own save/check) does not get its own AC as the DC", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+2", label: "Dexterity save", roller_id: "m1", target_id: "m1" });
    expect(r.rolls[0].dc).toBeUndefined();
    expect(r.out.vs_ac).toBeUndefined();
  });

  it("a secret targeted roll does not broadcast hit/miss (the TV hides the total but prints success/fail)", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+5", label: "attack", roller_id: "m1", target_id: "pc_f", secret: true }, rulesCtx(seq(15)));
    expect(r.out.vs_ac).toBe(16); // the DM still learns it
    expect(r.rolls[0].success).toBeUndefined();
  });
});

describe("spellAttacks scope", () => {
  it("one Fire Bolt does not make every later weapon attack this turn free", () => {
    let s = inCombat(["pc_w", "m1"], caster(["Fire Bolt"]));
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Fire Bolt", target_ids: ["m1"] }).state;
    s = run(s, "request_player_roll", { character_id: "pc_w", notation: "1d20+6", label: "Fire Bolt attack", target_id: "m1", attack_name: "Fire Bolt" }).state;
    const mace = run(s, "request_player_roll", { character_id: "pc_w", notation: "1d20+2", label: "Mace attack", target_id: "m1", attack_name: "Mace" });
    expect(mace.out.error).toMatch(/already used their action/);
  });

  it("a bonus-action attack spell (Spiritual Weapon) can make its attack without spending the main action", () => {
    let s = inCombat(["pc_w", "m1"], caster(["Spiritual Weapon"]));
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Spiritual Weapon", target_ids: ["m1"] }).state;
    expect(s.combat.turn).toMatchObject({ bonusAction: true, action: false });
    const r = run(s, "request_player_roll", { character_id: "pc_w", notation: "1d20+6", label: "Spiritual Weapon attack", target_id: "m1", attack_name: "Spiritual Weapon" });
    expect(r.out.error).toBeUndefined();
    expect(r.state.combat.turn).toMatchObject({ action: false });
  });
});

describe("already_recorded false positives", () => {
  afterEach(() => void vi.useRealTimers());
  const dm = (): EngineContext => ({ ...rulesCtx(seq(5)), source: "dm" });
  const record = (total: number, label = "Dagger attack") => ({ character_id: "pc_l", notation: "1d20+4", label, total });

  it("the DM recording two physical rolls of the same total (Extra Attack: '17 and 17') records both", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T20:00:00Z"));
    let s = run(party(), "record_physical_roll", record(17, "Dagger attack 1"), dm()).state;
    vi.setSystemTime(new Date("2026-10-19T20:00:02Z"));
    const r = run(s, "record_physical_roll", record(17, "Dagger attack 2"), dm());
    expect(r.out.already_recorded).toBeUndefined();
    expect(r.state.rolls).toHaveLength(s.rolls.length + 1);
  });
});

describe("saves and checks aimed at a creature are not attacks", () => {
  it("a save or check with a target gets no AC and keeps its DC without the nat-1 rule", () => {
    let r = run(party(), "roll_dice", { notation: "1d20+1", label: "Goblin Dex save", target_id: "m1" });
    expect(r.rolls[0].dc).toBeUndefined();
    r = run(party(), "request_player_roll", { character_id: "pc_f", notation: "1d20+15", label: "Persuasion check", target_id: "m1", dc: 15 }, rulesCtx(seq(1)));
    expect(r.out.success).toBe(true); // 16 >= 15: checks have no automatic failure
  });

  it("a roller given by name is still recognised as rolling for itself", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+1", label: "Goblin rolls", roller_id: "Goblin", target_id: "m1" });
    expect(r.rolls[0].dc).toBeUndefined();
  });
});

describe("the spell-attack allowance belongs to the spell's own rolls", () => {
  it("a weapon attack can't use a Fire Bolt roll the DM never made with target_id", () => {
    let s = inCombat(["pc_w", "m1"], caster(["Fire Bolt"]));
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Fire Bolt", target_ids: ["m1"] }).state;
    const mace = run(s, "request_player_roll", { character_id: "pc_w", notation: "1d20+2", label: "Mace attack", target_id: "m1", attack_name: "Mace" });
    expect(mace.out.error).toMatch(/already used their action/);
  });

  it("after Spiritual Weapon a mace attack spends the action, leaving the weapon's roll", () => {
    let s = inCombat(["pc_w", "m1"], caster(["Spiritual Weapon"]));
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Spiritual Weapon", target_ids: ["m1"] }).state;
    s = run(s, "request_player_roll", { character_id: "pc_w", notation: "1d20+2", label: "Mace attack", target_id: "m1", attack_name: "Mace" }).state;
    expect(s.combat.turn).toMatchObject({ action: true, spellAttacks: 1 });
  });

  it("casting the same attack spell again (Action Surge) adds its rays", () => {
    let s = inCombat(["pc_w", "m1"], caster(["Guiding Bolt"]));
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Guiding Bolt", target_ids: ["m1"] }).state;
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Guiding Bolt", target_ids: ["m1"], override: true }).state;
    expect(s.combat.turn).toMatchObject({ spellAttacks: 2, spellAttackSpell: "Guiding Bolt" });
  });
});

describe("a DM record right after the host answered the roll", () => {
  afterEach(() => void vi.useRealTimers());
  it("is reported as already recorded even when the DM heard another total", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T20:00:00Z"));
    let s = run(party(), "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }).state;
    s = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 17 }, { ...rulesCtx(seq(5)), source: "host" }).state;
    vi.setSystemTime(new Date("2026-10-19T20:00:05Z"));
    const r = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 19 }, { ...rulesCtx(seq(5)), source: "dm" });
    expect(r.out).toMatchObject({ already_recorded: true, recorded_total: 17 });
    expect(r.state.rolls).toHaveLength(s.rolls.length);
  });
});
