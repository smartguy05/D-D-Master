import { describe, expect, it } from "vitest";
import { GameState, type BoardEffect, type Character, type Monster } from "@dm/shared";
import { executeEngineTool, type EngineContext } from "./tools.js";
import { areaRadiusCells, projectileSplit } from "./effects.js";
import { applyDerived } from "./rules/derive.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./rules/testing.js";

function ctx(rolls: number[] = [10]): EngineContext {
  return rulesCtx(seq(...rolls));
}

const goblin = (over: Partial<Monster> = {}): Monster => ({
  id: "m1",
  name: "Goblin",
  maxHp: 7,
  hp: 7,
  ac: 13,
  initiativeBonus: 2,
  attacks: [
    { name: "Scimitar", toHit: 4, damage: "1d6+2 slashing", description: "Melee Attack Roll" },
    { name: "Shortbow", toHit: 4, damage: "1d6+2 piercing", description: "Ranged Attack Roll" },
  ],
  conditions: [],
  hidden: false,
  ...over,
});

const fighter = (over: Partial<Character> = {}) =>
  makeCharacter({
    id: "pc_f",
    name: "Thorin",
    attacks: [
      { name: "Longsword", toHit: 5, damage: "1d8+3 slashing" },
      { name: "Light Crossbow", toHit: 4, damage: "1d8+2 piercing" },
    ],
    ...over,
  });

const wizard = () =>
  applyDerived(
    makeCharacter({
      id: "pc_w",
      name: "Lyra",
      className: "Wizard",
      level: 5,
      proficiencyBonus: 3,
      abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
      spells: ["Fire Bolt", "Fireball", "Magic Missile", "Shield"],
    }),
    rulesCtx().classData("Wizard"),
  );

const cleric = () =>
  applyDerived(
    makeCharacter({ id: "pc_c", name: "Mira", className: "Cleric", level: 5, proficiencyBonus: 3, abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 } }),
    rulesCtx().classData("Cleric"),
  );

function party(): GameState {
  const s = stateWith(fighter(), wizard(), cleric());
  s.monsters.push(goblin(), goblin({ id: "m2", name: "Goblin 2" }), goblin({ id: "m3", name: "Goblin 3" }));
  return s;
}

const run = (s: GameState, tool: Parameters<typeof executeEngineTool>[1], args: unknown, rolls?: number[]) => executeEngineTool(s, tool, args, ctx(rolls));
const fx = (effects: BoardEffect[], kind: string) => effects.filter((e) => e.kind === kind);

describe("attack rolls with a target", () => {
  it("roll_dice: a monster's ranged attack flies an arrow and shows the hit", () => {
    const { outcome } = run(party(), "roll_dice", { notation: "1d20+4", label: "Goblin shortbow", roller_id: "m1", target_id: "pc_f", dc: 12 }, [15]);
    const [a] = fx(outcome.effects, "attack");
    expect(a).toMatchObject({ kind: "attack", style: "ranged", sourceId: "m1", targetId: "pc_f", outcome: "hit", label: "Shortbow", element: "piercing" });
    // the roller's own nat-20/1 flash is replaced by the reaction on the target
    expect(outcome.effects).toHaveLength(1);
  });

  it("attack_name wins over the label; a miss and a natural 20 crit", () => {
    let r = run(party(), "roll_dice", { notation: "1d20+4", label: "Goblin attack", attack_name: "scimitar", roller_id: "m1", target_id: "Thorin", dc: 20 }, [3]);
    expect(fx(r.outcome.effects, "attack")[0]).toMatchObject({ style: "melee", outcome: "miss", label: "Scimitar" });
    r = run(party(), "roll_dice", { notation: "1d20+4", label: "Goblin attack", attack_name: "scimitar", roller_id: "m1", target_id: "pc_f", dc: 30 }, [20]);
    expect(fx(r.outcome.effects, "attack")[0]).toMatchObject({ outcome: "crit" });
    r = run(party(), "roll_dice", { notation: "1d20+20", label: "Goblin attack", roller_id: "m1", target_id: "pc_f", dc: 5 }, [1]);
    expect(fx(r.outcome.effects, "attack")[0]).toMatchObject({ outcome: "miss" });
  });

  it("no dc: travel without an outcome; secret rolls and rolls without a target show nothing new", () => {
    let r = run(party(), "roll_dice", { notation: "1d20+4", label: "Shortbow", roller_id: "m1", target_id: "pc_f" }, [12]);
    expect(fx(r.outcome.effects, "attack")[0].outcome).toBeUndefined();
    r = run(party(), "roll_dice", { notation: "1d20+4", label: "Shortbow", roller_id: "m1", target_id: "pc_f", secret: true, dc: 10 }, [12]);
    expect(r.outcome.effects).toEqual([]);
    r = run(party(), "roll_dice", { notation: "1d20+4", label: "Perception", roller_id: "m1" }, [20]);
    expect(r.outcome.effects.map((e) => e.kind)).toEqual(["crit"]); // the old roller flash
  });

  it("an unknown target_id is ignored (the roll still happens)", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+4", label: "Shortbow", roller_id: "m1", target_id: "nobody", dc: 10 }, [12]);
    expect(r.outcome.rolls).toHaveLength(1);
    expect(fx(r.outcome.effects, "attack")).toEqual([]);
  });

  it("request_player_roll (virtual): a PC's crossbow is ranged, a longsword melee, a spell attack an orb", () => {
    let r = run(party(), "request_player_roll", { character_id: "pc_f", notation: "1d20+4", label: "Light Crossbow attack", target_id: "m1", dc: 13 }, [14]);
    expect(fx(r.outcome.effects, "attack")[0]).toMatchObject({ style: "ranged", sourceId: "pc_f", targetId: "m1", outcome: "hit" });
    r = run(party(), "request_player_roll", { character_id: "pc_f", notation: "1d20+5", label: "Attack", attack_name: "Longsword", target_id: "m1", dc: 13 }, [14]);
    expect(fx(r.outcome.effects, "attack")[0]).toMatchObject({ style: "melee" });
    r = run(party(), "request_player_roll", { character_id: "pc_w", notation: "1d20+6", label: "Fire Bolt attack", target_id: "m1", dc: 13 }, [14]);
    expect(fx(r.outcome.effects, "attack")[0]).toMatchObject({ style: "spell", element: "fire", label: "Fire Bolt" });
  });

  it("physical dice: the target is kept on pendingRoll and record_physical_roll shows the attack", () => {
    const s = party();
    s.characters[0].diceMode = "physical";
    const asked = run(s, "request_player_roll", { character_id: "pc_f", notation: "1d20+5", label: "Longsword attack", target_id: "m1", dc: 13 });
    expect(asked.outcome.effects).toEqual([]);
    expect(asked.state.pendingRoll).toMatchObject({ targetId: "m1", attackName: undefined });
    const rec = run(asked.state, "record_physical_roll", { character_id: "pc_f", notation: "1d20+5", label: "Longsword attack", total: 9 });
    expect(fx(rec.outcome.effects, "attack")[0]).toMatchObject({ style: "melee", sourceId: "pc_f", targetId: "m1", outcome: "miss" });
  });

  it("an old saved pendingRoll without target fields still loads", () => {
    const s = GameState.parse({ campaignId: "c1", pendingRoll: { characterId: "pc_f", notation: "1d20", label: "Check" } });
    expect(s.pendingRoll).toMatchObject({ kind: "check" });
    expect(s.pendingRoll?.targetId).toBeUndefined();
  });
});

describe("apply_damage with a source", () => {
  it("one hit effect that travels from the source, styled from attack_name", () => {
    const { outcome } = run(party(), "apply_damage", { target_id: "pc_f", amount: 4, damage_type: "piercing", source_id: "m1", attack_name: "Shortbow" });
    expect(outcome.effects).toHaveLength(1);
    expect(outcome.effects[0]).toMatchObject({ kind: "hit", targetId: "pc_f", sourceId: "m1", style: "ranged", label: "Shortbow", element: "piercing" });
  });

  it("critical is a crit outcome; no source keeps the plain hit", () => {
    let r = run(party(), "apply_damage", { target_id: "m1", amount: 9, source_id: "pc_f", critical: true });
    expect(r.outcome.effects[0]).toMatchObject({ kind: "hit", style: "melee", outcome: "crit" });
    r = run(party(), "apply_damage", { target_id: "m1", amount: 3, damage_type: "fire" });
    expect(r.outcome.effects[0]).toEqual({ id: expect.any(String), ts: expect.any(Number), kind: "hit", targetId: "m1", element: "fire" });
  });

  it("damage from an area spell does not fly an orb to every target", () => {
    const r = run(party(), "apply_damage", { target_id: "m1", amount: 20, damage_type: "fire", source_id: "pc_w", attack_name: "Fireball" });
    expect(r.outcome.effects[0].sourceId).toBeUndefined();
    expect(r.outcome.effects[0].style).toBeUndefined();
  });
});

describe("cast_spell effects", () => {
  it("Fire Bolt: a fire orb to the target", () => {
    const { outcome } = run(party(), "cast_spell", { caster_id: "pc_w", spell: "Fire Bolt", target_ids: ["m1"] });
    expect(outcome.effects).toEqual([expect.objectContaining({ kind: "attack", style: "spell", sourceId: "pc_w", targetId: "m1", element: "fire", label: "Fire Bolt" })]);
  });

  it("Fireball at a point: one area burst, radius 4 cells (20 ft / 5)", () => {
    const { outcome } = run(party(), "cast_spell", { caster_id: "pc_w", spell: "Fireball", target_ids: ["m1", "m2"], x: 6, y: 3 });
    expect(outcome.effects).toEqual([expect.objectContaining({ kind: "area", style: "area", x: 6, y: 3, radius: 4, shape: "sphere", element: "fire", sourceId: "pc_w" })]);
  });

  it("Fireball without a point bursts on the first target", () => {
    const { outcome } = run(party(), "cast_spell", { caster_id: "pc_w", spell: "Fireball", target_ids: ["m2"] });
    expect(outcome.effects[0]).toMatchObject({ kind: "area", targetId: "m2", radius: 4 });
  });

  it("Magic Missile: 3 darts split over the targets", () => {
    let r = run(party(), "cast_spell", { caster_id: "pc_w", spell: "Magic Missile", target_ids: ["m1"] });
    expect(r.outcome.effects).toEqual([expect.objectContaining({ kind: "attack", style: "spell", targetId: "m1", count: 3, element: "force" })]);
    r = run(party(), "cast_spell", { caster_id: "pc_w", spell: "Magic Missile", target_ids: ["m1", "m2"] });
    expect(r.outcome.effects.map((e) => e.count)).toEqual([2, 1]);
  });

  it("a single-target save spell bursts on the target in its element", () => {
    const { outcome } = run(party(), "cast_spell", { caster_id: "pc_c", spell: "Sacred Flame", target_ids: ["m1"] });
    expect(outcome.effects).toEqual([expect.objectContaining({ kind: "radiant", targetId: "m1", sourceId: "pc_c", style: "spell", label: "Sacred Flame" })]);
  });

  it("healing spells glow on the targets, else the caster; other spells sparkle arcane", () => {
    let r = run(party(), "cast_spell", { caster_id: "pc_c", spell: "Cure Wounds", target_ids: ["pc_f"] });
    expect(r.outcome.effects).toEqual([expect.objectContaining({ kind: "heal", targetId: "pc_f", label: "Cure Wounds" })]);
    r = run(party(), "cast_spell", { caster_id: "pc_w", spell: "Shield" });
    expect(r.outcome.effects).toEqual([expect.objectContaining({ kind: "arcane", targetId: "pc_w", label: "Shield" })]);
  });

  it("a failed cast shows nothing", () => {
    const s = party();
    s.characters[1].spellSlots.forEach((x) => (x.used = x.max));
    const r = run(s, "cast_spell", { caster_id: "pc_w", spell: "Fireball", x: 1, y: 1 });
    expect(r.outcome.effects).toEqual([]);
  });
});

describe("helpers", () => {
  it("areaRadiusCells: radius shapes ft/5, cube and cone half their size, line half its width", () => {
    expect(areaRadiusCells({ shape: "sphere", sizeFt: 20 })).toBe(4);
    expect(areaRadiusCells({ shape: "emanation", sizeFt: 15 })).toBe(3);
    expect(areaRadiusCells({ shape: "cylinder", sizeFt: 10 })).toBe(2);
    expect(areaRadiusCells({ shape: "cube", sizeFt: 15 })).toBe(1.5);
    expect(areaRadiusCells({ shape: "cone", sizeFt: 60 })).toBe(6);
    expect(areaRadiusCells({ shape: "line", sizeFt: 100, widthFt: 5 })).toBe(1);
    expect(areaRadiusCells({ shape: "sphere", sizeFt: 500 })).toBe(20);
  });

  it("projectileSplit spreads darts round-robin, at least 1 and at most 6 per target", () => {
    expect(projectileSplit(3, 1)).toEqual([3]);
    expect(projectileSplit(3, 2)).toEqual([2, 1]);
    expect(projectileSplit(3, 3)).toEqual([1, 1, 1]);
    expect(projectileSplit(2, 3)).toEqual([1, 1, 1]);
    expect(projectileSplit(12, 1)).toEqual([6]);
  });
});
