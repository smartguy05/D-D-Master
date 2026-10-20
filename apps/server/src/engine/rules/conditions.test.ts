import { describe, expect, it } from "vitest";
import { Monster, type Character, type GameState } from "@dm/shared";
import { executeEngineTool, type EngineTool } from "../tools.js";
import { applyDerived } from "./derive.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./testing.js";

/**
 * Spell conditions linked to their source (bug spell-conditions-outlive-concentration): add_condition
 * takes source_spell / caster_id / duration_rounds / until_end_of_turn_of and records it in the
 * entity's conditionMeta; ending the caster's concentration, the duration running out or a long rest
 * removes the condition again.
 */

const run = (s: GameState, name: EngineTool, args: unknown, rng = seq(10)) => executeEngineTool(s, name, args, rulesCtx(rng));

type Meta = { name: string; casterId?: string; spell?: string; until?: { kind: string; round?: number; entityId?: string } };
const metaOf = (e: object) => (e as { conditionMeta?: Meta[] }).conditionMeta;

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
      spells: ["Bless", "Shield of Faith"],
      ...over,
    }),
    rulesCtx().classData("Cleric"),
  );
const fighter = (over: Partial<Character> = {}) => makeCharacter({ id: "pc_f", name: "Brienne", className: "Fighter", maxHp: 20, hp: 20, ...over });
const rogue = (over: Partial<Character> = {}) => makeCharacter({ id: "pc_r", name: "Tam", className: "Rogue", maxHp: 14, hp: 14, ...over });
const goblin = () => Monster.parse({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13 });

const pc = (s: GameState, id: string) => s.characters.find((c) => c.id === id)!;

/** Morra casts Bless and the DM marks Brienne and Tam Blessed, linked to the spell. */
function blessed(): GameState {
  let s = stateWith(cleric(), fighter(), rogue());
  s = run(s, "cast_spell", { caster_id: "pc_c", spell: "Bless", target_ids: ["pc_f", "pc_r"] }).state;
  expect(pc(s, "pc_c").concentration?.spell).toBe("Bless");
  for (const id of ["pc_f", "pc_r"]) s = run(s, "add_condition", { target_id: id, condition: "Blessed", source_spell: "Bless", caster_id: "pc_c" }).state;
  return s;
}

function expectNotBlessed(s: GameState) {
  for (const id of ["pc_f", "pc_r"]) {
    expect(pc(s, id).conditions).not.toContain("Blessed");
    expect(metaOf(pc(s, id)) ?? []).toEqual([]);
  }
}

describe("conditionMeta schema", () => {
  it("defaults to [] on characters and monsters", () => {
    expect(metaOf(fighter())).toEqual([]);
    expect(metaOf(goblin())).toEqual([]);
  });
});

describe("conditions linked to concentration", () => {
  it("add_condition with source_spell the caster concentrates on links it automatically", () => {
    const s = blessed();
    for (const id of ["pc_f", "pc_r"]) {
      expect(pc(s, id).conditions).toContain("Blessed");
      expect(metaOf(pc(s, id))).toEqual([expect.objectContaining({ name: "Blessed", casterId: "pc_c", spell: "Bless", until: expect.objectContaining({ kind: "concentration" }) })]);
    }
  });

  it("end_concentration for the caster removes the linked condition from every target", () => {
    const s = run(blessed(), "end_concentration", { character_id: "pc_c" }).state;
    expectNotBlessed(s);
  });

  it("casting another concentration spell (replacing Bless) removes it", () => {
    const s = run(blessed(), "cast_spell", { caster_id: "pc_c", spell: "Shield of Faith", target_ids: ["pc_c"] }).state;
    expect(pc(s, "pc_c").concentration?.spell).toBe("Shield of Faith");
    expectNotBlessed(s);
  });

  it("concentration broken by damage (failed CON save) removes it", () => {
    // CON 14 (+2), Cleric has no CON save proficiency: 2 + 2 = 4 < DC 10.
    const r = run(blessed(), "apply_damage", { target_id: "pc_c", amount: 5 }, seq(2));
    expect(pc(r.state, "pc_c").concentration).toBeNull();
    expectNotBlessed(r.state);
  });

  it("without concentration on the source spell it is tracked but not removed by an unrelated end_concentration", () => {
    let s = stateWith(cleric({ concentration: { spell: "Shield of Faith", since: 1 } }), fighter());
    s = run(s, "add_condition", { target_id: "pc_f", condition: "Blessed", source_spell: "Bless", caster_id: "pc_c" }).state;
    const meta = metaOf(pc(s, "pc_f"));
    expect(meta).toEqual([expect.objectContaining({ name: "Blessed", spell: "Bless", casterId: "pc_c" })]);
    expect(meta?.[0].until?.kind).not.toBe("concentration");
    s = run(s, "end_concentration", { character_id: "pc_c" }).state;
    expect(pc(s, "pc_f").conditions).toContain("Blessed");
  });
});

describe("timed conditions in combat", () => {
  /** Morra (not concentrating), Brienne, Goblin: Morra's turn in round 1. */
  function combat(): GameState {
    const s = stateWith(cleric(), fighter());
    s.monsters.push(goblin());
    s.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      order: [
        { entityId: "pc_c", entityType: "character", name: "Morra", initiative: 18 },
        { entityId: "pc_f", entityType: "character", name: "Brienne", initiative: 12 },
        { entityId: "m1", entityType: "monster", name: "Goblin", initiative: 6 },
      ],
      turn: null,
      reactionsUsed: [], announced: [],
    };
    return s;
  }

  it("duration_rounds with a caster: expires at the start of the caster's turn duration_rounds later", () => {
    let s = run(combat(), "add_condition", { target_id: "pc_f", condition: "Dazed", source_spell: "Command", caster_id: "pc_c", duration_rounds: 1 }).state;
    expect(metaOf(pc(s, "pc_f"))).toEqual([expect.objectContaining({ name: "Dazed", until: expect.objectContaining({ kind: "rounds" }) })]);
    s = run(s, "next_turn", {}).state; // Brienne, round 1
    expect(pc(s, "pc_f").conditions).toContain("Dazed");
    s = run(s, "next_turn", {}).state; // Goblin, round 1
    expect(pc(s, "pc_f").conditions).toContain("Dazed");
    s = run(s, "next_turn", {}).state; // Morra, round 2
    expect(s.combat.round).toBe(2);
    expect(pc(s, "pc_f").conditions).not.toContain("Dazed");
    expect(metaOf(pc(s, "pc_f")) ?? []).toEqual([]);
  });

  it("duration_rounds without a caster: expires at the start of the affected creature's turn", () => {
    let s = run(combat(), "add_condition", { target_id: "pc_f", condition: "Dazed", duration_rounds: 1 }).state;
    s = run(s, "next_turn", {}).state; // Brienne, round 1
    s = run(s, "next_turn", {}).state; // Goblin, round 1
    s = run(s, "next_turn", {}).state; // Morra, round 2
    expect(pc(s, "pc_f").conditions).toContain("Dazed");
    s = run(s, "next_turn", {}).state; // Brienne, round 2
    expect(pc(s, "pc_f").conditions).not.toContain("Dazed");
  });

  it("until_end_of_turn_of X: removed by next_turn when X's turn ends", () => {
    let s = run(combat(), "add_condition", { target_id: "m1", condition: "Dazzled", source_spell: "Some Spell", caster_id: "pc_c", until_end_of_turn_of: "m1" }).state;
    const gob = () => s.monsters.find((m) => m.id === "m1")!;
    expect(metaOf(gob())).toEqual([expect.objectContaining({ name: "Dazzled", until: expect.objectContaining({ kind: "end_of_turn", entityId: "m1" }) })]);
    s = run(s, "next_turn", {}).state; // Brienne
    expect(gob().conditions).toContain("Dazzled");
    s = run(s, "next_turn", {}).state; // Goblin's turn starts
    expect(gob().conditions).toContain("Dazzled");
    s = run(s, "next_turn", {}).state; // Goblin's turn ended
    expect(gob().conditions).not.toContain("Dazzled");
    expect(metaOf(gob()) ?? []).toEqual([]);
  });
});

describe("rests and remove_condition", () => {
  it("long_rest removes spell conditions (with meta) but keeps a plain Poisoned", () => {
    let s = stateWith(cleric(), fighter());
    s = run(s, "add_condition", { target_id: "pc_f", condition: "Blessed", source_spell: "Bless", caster_id: "pc_c" }).state;
    s = run(s, "add_condition", { target_id: "pc_f", condition: "Poisoned" }).state;
    s = run(s, "long_rest", {}).state;
    expect(pc(s, "pc_f").conditions).toEqual(["Poisoned"]);
    expect(metaOf(pc(s, "pc_f")) ?? []).toEqual([]);
  });

  it("remove_condition removes the matching meta too", () => {
    let s = blessed();
    s = run(s, "remove_condition", { target_id: "pc_f", condition: "blessed" }).state;
    expect(pc(s, "pc_f").conditions).not.toContain("Blessed");
    expect(metaOf(pc(s, "pc_f"))).toEqual([]);
    expect(metaOf(pc(s, "pc_r"))).toHaveLength(1);
  });
});
