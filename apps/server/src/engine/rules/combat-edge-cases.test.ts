import { describe, expect, it } from "vitest";
import { Monster, type Character, type GameState } from "@dm/shared";
import { executeEngineTool, type EngineTool } from "../tools.js";
import { applyDerived } from "./derive.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./testing.js";

/**
 * Edge cases of the death-save guard and spell-linked conditions (conditionMeta), from the
 * adversarial review of the 2026-10-19 test-run fixes.
 */

const run = (s: GameState, name: EngineTool, args: unknown, rng = seq(15)) => executeEngineTool(s, name, args, rulesCtx(rng));
const pc = (s: GameState, id: string) => s.characters.find((c) => c.id === id)!;
const mon = (s: GameState, id: string) => s.monsters.find((m) => m.id === id)!;

const cleric = (over: Partial<Character> = {}) =>
  applyDerived(
    makeCharacter({
      id: "pc_c",
      name: "Morra",
      className: "Cleric",
      level: 3,
      maxHp: 20,
      hp: 20,
      proficiencyBonus: 2,
      abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
      spells: ["Bless", "Hold Person"],
      ...over,
    }),
    rulesCtx().classData("Cleric"),
  );
const fighter = (over: Partial<Character> = {}) => makeCharacter({ id: "pc_f", name: "Brienne", className: "Fighter", maxHp: 20, hp: 20, ...over });

describe("death save guard: lastRolled across combats", () => {
  it("a downed PC who wins initiative in a NEW combat still makes the start-of-turn death save", () => {
    // Fight 1: Brienne is down and acts first in round 1, so start_combat rolls her save (key round 1 / pc_f).
    let s = stateWith(fighter({ hp: 0, conditions: ["Unconscious"] }));
    s.monsters.push(Monster.parse({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13, initiativeBonus: -1 }));
    const first = run(s, "start_combat", {});
    expect((first.outcome.output as { death_save?: { error?: string } }).death_save?.error).toBeUndefined();
    s = run(first.state, "end_combat", {}).state; // the party withdraws; she is still at 0 HP, not stable
    expect(pc(s, "pc_f").deathSaves.stable).toBe(false);
    // Fight 2 starts: she is first again in round 1. Her turn starts at 0 HP: SRD says she rolls.
    const second = run(s, "start_combat", {});
    const ds = (second.outcome.output as { death_save?: { error?: string; success?: boolean } }).death_save;
    expect(ds?.error).toBeUndefined();
    expect(ds?.success).toBe(true);
  });
});

describe("conditionMeta: concentration with a duration", () => {
  it("Bless with duration_rounds still ends when the caster's concentration ends", () => {
    let s = stateWith(cleric(), fighter());
    s.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      order: [
        { entityId: "pc_c", entityType: "character", name: "Morra", initiative: 18 },
        { entityId: "pc_f", entityType: "character", name: "Brienne", initiative: 12 },
      ],
      turn: null,
      reactionsUsed: [],
    };
    s = run(s, "cast_spell", { caster_id: "pc_c", spell: "Bless", target_ids: ["pc_f"] }).state;
    expect(pc(s, "pc_c").concentration?.spell).toBe("Bless");
    // "Concentration, up to 1 minute": the DM passes both, as the tool description invites.
    s = run(s, "add_condition", { target_id: "pc_f", condition: "Blessed", source_spell: "Bless", caster_id: "pc_c", duration_rounds: 10 }).state;
    s = run(s, "end_concentration", { character_id: "pc_c" }).state;
    expect(pc(s, "pc_f").conditions).not.toContain("Blessed");
  });
});

describe("conditionMeta: a plain condition shared with a spell one", () => {
  it("ending Hold Person keeps Paralyzed that another (plain) source applied first", () => {
    let s = stateWith(cleric());
    s.monsters.push(Monster.parse({ id: "m1", name: "Bandit", maxHp: 11, hp: 11, ac: 12 }));
    // A ghoul's claw paralyzed the bandit (plain condition, no meta)...
    s = run(s, "add_condition", { target_id: "m1", condition: "Paralyzed" }).state;
    // ...then Morra's Hold Person also holds it.
    s = run(s, "cast_spell", { caster_id: "pc_c", spell: "Hold Person", target_ids: ["m1"] }).state;
    expect(pc(s, "pc_c").concentration?.spell).toBe("Hold Person");
    s = run(s, "add_condition", { target_id: "m1", condition: "Paralyzed", source_spell: "Hold Person", caster_id: "pc_c" }).state;
    s = run(s, "end_concentration", { character_id: "pc_c" }).state;
    expect(mon(s, "m1").conditions).toContain("Paralyzed");
  });
});

describe("conditionMeta: timed conditions that can never expire", () => {
  function fight(): GameState {
    const s = stateWith(cleric(), fighter());
    s.monsters.push(Monster.parse({ id: "m1", name: "Goblin Shaman", maxHp: 7, hp: 7, ac: 13 }));
    s.combat = {
      active: true,
      round: 1,
      turnIndex: 2,
      order: [
        { entityId: "pc_c", entityType: "character", name: "Morra", initiative: 18 },
        { entityId: "pc_f", entityType: "character", name: "Brienne", initiative: 12 },
        { entityId: "m1", entityType: "monster", name: "Goblin Shaman", initiative: 6 },
      ],
      turn: null,
      reactionsUsed: [],
    };
    return s;
  }

  it("a 1-round effect keyed to a caster that dies still wears off", () => {
    let s = run(fight(), "add_condition", { target_id: "pc_f", condition: "Dazed", caster_id: "m1", duration_rounds: 1 }).state;
    s = run(s, "apply_damage", { target_id: "m1", amount: 20 }).state; // the shaman dies
    for (let i = 0; i < 6; i++) s = run(s, "next_turn", {}).state; // three full rounds pass (dead shaman skipped)
    expect(s.combat.round).toBeGreaterThanOrEqual(3);
    expect(pc(s, "pc_f").conditions).not.toContain("Dazed");
  });

  it("an 'until the end of its turn' effect keyed to a creature removed from the map still wears off", () => {
    let s = run(fight(), "add_condition", { target_id: "pc_f", condition: "Frightened", until_end_of_turn_of: "m1" }).state;
    s = run(s, "remove_monster", { monster_id: "m1" }).state;
    for (let i = 0; i < 4; i++) s = run(s, "next_turn", {}).state;
    expect(pc(s, "pc_f").conditions).not.toContain("Frightened");
  });

  it("end_combat clears round-based durations (no turns left to expire them)", () => {
    let s = run(fight(), "add_condition", { target_id: "pc_f", condition: "Dazed", duration_rounds: 1 }).state;
    s = run(s, "end_combat", {}).state;
    expect(pc(s, "pc_f").conditions).not.toContain("Dazed");
  });
});

describe("code-review follow-ups (conditions)", () => {
  it("'until the end of its next turn' set on that creature's own turn lasts through its next turn", () => {
    let s = stateWith(makeCharacter({ id: "pc_a", name: "Ana" }), makeCharacter({ id: "pc_b", name: "Bo" }));
    s.combat = { active: true, round: 1, turnIndex: 0, order: [
      { entityId: "pc_a", entityType: "character", name: "Ana", initiative: 15 },
      { entityId: "pc_b", entityType: "character", name: "Bo", initiative: 10 },
    ], turn: null, reactionsUsed: [] };
    const run = (st: typeof s, name: string, args: unknown) => executeEngineTool(st, name as never, args, rulesCtx(seq(10))).state;
    s = run(s, "add_condition", { target_id: "pc_b", condition: "Glowing", until_end_of_turn_of: "pc_a" });
    s = run(s, "next_turn", {}); // Ana's turn ends (round 1): still on
    expect(s.characters[1].conditions).toContain("Glowing");
    s = run(s, "next_turn", {}); // Ana, round 2
    s = run(s, "next_turn", {}); // Ana's round-2 turn ended
    expect(s.characters[1].conditions).not.toContain("Glowing");
  });

  it("a creature at 0 HP keeps Unconscious when a linked Unconscious (Sleep) ends", () => {
    let s = stateWith(makeCharacter({ id: "pc_c", name: "Caster", concentration: { spell: "Sleep", since: 1 } }), makeCharacter({ id: "pc_t", name: "Target" }));
    const run = (st: typeof s, name: string, args: unknown) => executeEngineTool(st, name as never, args, rulesCtx(seq(10))).state;
    s = run(s, "add_condition", { target_id: "pc_t", condition: "Unconscious", source_spell: "Sleep", caster_id: "pc_c" });
    s.characters[1].hp = 0;
    s = run(s, "end_concentration", { character_id: "pc_c" });
    expect(s.characters[1].conditions).toContain("Unconscious");
  });
});
