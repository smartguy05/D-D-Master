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
  speed: 30,
  attacksPerAction: 1,
  attacks: [
    { name: "Scimitar", toHit: 4, damage: "1d6+2 slashing", description: "Melee Attack Roll" },
    { name: "Shortbow", toHit: 4, damage: "1d6+2 piercing", description: "Ranged Attack Roll" },
  ],
  conditions: [],
  hidden: false,
  npc: false,
  appearance: "",
  ally: false,
  follows: false,
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
    let r = run(party(), "apply_damage", { target_id: "m1", amount: 9, source_id: "pc_f", attack_name: "Longsword", critical: true });
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
    // travel only: the attack roll that follows gives hit/miss/crit
    expect(outcome.effects[0].outcome).toBeUndefined();
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
    // Magic Missile always hits: the darts carry outcome hit
    expect(r.outcome.effects).toEqual([expect.objectContaining({ kind: "attack", style: "spell", targetId: "m1", count: 3, element: "force", outcome: "hit" })]);
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
    expect(projectileSplit(2, 3)).toEqual([1, 1]); // only as many targets as darts
    expect(projectileSplit(3, 13)).toEqual([1, 1, 1]);
    expect(projectileSplit(0, 2)).toEqual([]);
    expect(projectileSplit(12, 1)).toEqual([6]);
  });
});

// Review round 1 (2026-10-18): spells listed as attacks, unresolved damage sources, flash fallback, darts, magical rays.
describe("review round 1", () => {
  const ctx = (rolls: number[] = [10]): EngineContext => rulesCtx(seq(...rolls));
  const run = (s: GameState, tool: Parameters<typeof executeEngineTool>[1], args: unknown, rolls?: number[]) => executeEngineTool(s, tool, args, ctx(rolls));
  const fx = (effects: BoardEffect[], kind: string) => effects.filter((e) => e.kind === kind);

  const monster = (over: Partial<Monster> = {}): Monster => ({
    id: "m1",
    name: "Goblin",
    maxHp: 7,
    hp: 7,
    ac: 13,
    initiativeBonus: 2,
    speed: 30,
    attacksPerAction: 1,
    attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2 slashing", description: "Melee Attack Roll" }],
    conditions: [],
    hidden: false,
    npc: false,
    appearance: "",
    ally: false,
    follows: false,
    ...over,
  });

  // A wizard as the character builder writes one: the cantrip is also listed under attacks
  // (the content prompt asks for "attacks (with toHit and damage ...)").
  const wizard = (over: Partial<Character> = {}) =>
    applyDerived(
      makeCharacter({
        id: "pc_w",
        name: "Lyra",
        className: "Wizard",
        level: 5,
        proficiencyBonus: 3,
        abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
        spells: ["Fire Bolt", "Fireball"],
        attacks: [{ name: "Fire Bolt", toHit: 6, damage: "2d10 fire" }],
        ...over,
      }),
      rulesCtx().classData("Wizard"),
    );

  function party(): GameState {
    const s = stateWith(wizard());
    s.monsters.push(monster(), monster({ id: "m2", name: "Goblin 2" }));
    return s;
  }

  describe("emission", () => {
    it("a PC's spell listed under attacks (Fire Bolt) animates as a spell orb, not a melee swing", () => {
      const r = run(party(), "roll_dice", { notation: "1d20+6", label: "Fire Bolt attack", roller_id: "pc_w", attack_name: "Fire Bolt", target_id: "m1", dc: 13 }, [15]);
      expect(fx(r.outcome.effects, "attack")[0]).toMatchObject({ style: "spell", element: "fire" });
    });

    it("apply_damage from a Fireball caster without attack_name does not swing a melee weapon at each target", () => {
      let s = run(party(), "cast_spell", { caster_id: "pc_w", spell: "Fireball", target_ids: ["m1", "m2"], x: 8, y: 8 }).state;
      const r1 = run(s, "apply_damage", { target_id: "m1", amount: 20, damage_type: "fire", source_id: "pc_w" });
      s = r1.state;
      const r2 = run(s, "apply_damage", { target_id: "m2", amount: 20, damage_type: "fire", source_id: "pc_w" });
      for (const e of [...r1.outcome.effects, ...r2.outcome.effects]) expect(e.style).not.toBe("melee");
    });

    it("apply_damage with source_id but no attack_name from a ranged-only monster is not a melee swing", () => {
      const s = party();
      s.monsters[0].attacks = [{ name: "Longbow", toHit: 4, damage: "1d8+2 piercing", description: "Ranged Attack Roll" }];
      const r = run(s, "apply_damage", { target_id: "pc_w", amount: 5, damage_type: "piercing", source_id: "m1" });
      expect(r.outcome.effects[0].style).not.toBe("melee");
    });

    it("an unresolved target_id still keeps the roller's natural-20 flash", () => {
      const r = run(party(), "roll_dice", { notation: "1d20+4", label: "Scimitar", roller_id: "m1", target_id: "nobody", dc: 10 }, [20]);
      expect(r.outcome.effects.map((e) => e.kind)).toEqual(["crit"]);
    });

    it("projectileSplit never yields a 0-dart target (schema count min 1)", () => {
      expect(Math.min(...projectileSplit(3, 13))).toBeGreaterThanOrEqual(1);
    });

    it("a magical ranged monster attack (Necrotic Ray) is a spell orb, not a wooden arrow", () => {
      const s = party();
      s.monsters[0].attacks = [{ name: "Necrotic Ray", toHit: 5, damage: "3d8 necrotic", description: "Ranged Attack Roll" }];
      const r = run(s, "roll_dice", { notation: "1d20+5", label: "Necrotic Ray", roller_id: "m1", target_id: "pc_w", dc: 12 }, [15]);
      expect(fx(r.outcome.effects, "attack")[0].style).toBe("spell");
    });
  });
});

describe("review round 1: more mutations", () => {
  it("an emanation is always centred on the caster, even with targets and a point", () => {
    const s = party();
    const { outcome } = run(s, "cast_spell", { caster_id: "pc_c", spell: "Spirit Guardians", target_ids: ["m1"], x: 7, y: 7 });
    expect(outcome.effects).toEqual([expect.objectContaining({ kind: "area", targetId: "pc_c", shape: "emanation", radius: 3 })]);
    expect(outcome.effects[0].x).toBeUndefined();
  });

  it("advantage: the natural is the kept die (2d20kh1)", () => {
    let r = run(party(), "roll_dice", { notation: "2d20kh1+4", label: "Shortbow", roller_id: "m1", target_id: "pc_f", dc: 30 }, [20, 3]);
    expect(fx(r.outcome.effects, "attack")[0].outcome).toBe("crit");
    r = run(party(), "roll_dice", { notation: "2d20kh1+4", label: "Shortbow", roller_id: "m1", target_id: "pc_f", dc: 12 }, [1, 15]);
    expect(fx(r.outcome.effects, "attack")[0].outcome).toBe("hit"); // the dropped 1 is not a fumble
  });

  it("apply_damage: a source with exactly one attack uses it; several and no attack_name → plain hit, no travel", () => {
    const s = party();
    s.monsters[0].attacks = [{ name: "Longbow", toHit: 4, damage: "1d8+2 piercing", description: "Ranged Attack Roll" }];
    let r = run(s, "apply_damage", { target_id: "pc_f", amount: 5, source_id: "m1" });
    expect(r.outcome.effects[0]).toMatchObject({ style: "ranged", sourceId: "m1", label: "Longbow" });
    r = run(party(), "apply_damage", { target_id: "pc_f", amount: 5, damage_type: "slashing", source_id: "m1" });
    expect(r.outcome.effects[0]).toEqual({ id: expect.any(String), ts: expect.any(Number), kind: "hit", targetId: "pc_f", element: "slashing" });
  });

  it("Melee or Ranged attacks: adjacent tokens swing, distant ones throw", () => {
    const s = party();
    s.monsters[0].attacks = [{ name: "Javelin", toHit: 4, damage: "1d6+2 piercing", description: "Melee or Ranged Attack Roll" }];
    s.tokens.push({ id: "t1", entityId: "m1", entityType: "monster", x: 2, y: 2, size: 1 }, { id: "t2", entityId: "pc_f", entityType: "character", x: 3, y: 3, size: 1 });
    let r = run(s, "roll_dice", { notation: "1d20+4", label: "Javelin", roller_id: "m1", target_id: "pc_f", dc: 10 }, [12]);
    expect(fx(r.outcome.effects, "attack")[0].style).toBe("melee");
    s.tokens[1].x = 8;
    r = run(s, "roll_dice", { notation: "1d20+4", label: "Javelin", roller_id: "m1", target_id: "pc_f", dc: 10 }, [12]);
    expect(fx(r.outcome.effects, "attack")[0].style).toBe("ranged");
  });
});

// Review round 2 (2026-10-18).
describe("review round 2", () => {
  const wyrmling = (): Monster => ({
    id: "m_drg",
    name: "Red Dragon Wyrmling",
    maxHp: 75,
    hp: 75,
    ac: 17,
    initiativeBonus: 2,
    speed: 30,
    attacksPerAction: 1,
    // what parseStatBlock yields: Fire Breath is a save action, not an attack
    attacks: [{ name: "Rend", toHit: 6, damage: "1d10+4 slashing", description: "Melee Attack Roll" }],
    conditions: [],
    hidden: false,
    npc: false,
    appearance: "",
    ally: false,
    follows: false,
  });

  const fighter = () => makeCharacter({ id: "pc_f", name: "Thorin", attacks: [{ name: "Longsword", toHit: 5, damage: "1d8+3 slashing" }] });

  const run = (s: ReturnType<typeof stateWith>, args: unknown) => executeEngineTool(s, "apply_damage", args, rulesCtx(seq(10)));
  const hit = (effects: BoardEffect[]) => effects.find((e) => e.kind === "hit")!;

  describe(" single-attack fallback misfires", () => {
    it("Fire Breath named but not an attack: no Rend swing at each creature in the cone", () => {
      const s = stateWith(fighter());
      s.monsters.push(wyrmling());
      const r = run(s, { target_id: "pc_f", amount: 24, damage_type: "fire", source_id: "m_drg", attack_name: "Fire Breath" });
      expect(hit(r.outcome.effects).style).toBeUndefined();
      expect(hit(r.outcome.effects).label).not.toBe("Rend");
    });

    it("breath damage without attack_name, damage type unlike the only attack's: plain hit", () => {
      const s = stateWith(fighter());
      s.monsters.push(wyrmling());
      const r = run(s, { target_id: "pc_f", amount: 24, damage_type: "fire", source_id: "m_drg" });
      expect(hit(r.outcome.effects).style).toBeUndefined();
    });

    it("Fireball follow-up damage (no attack_name) from a caster whose only attack is Fire Bolt: no orb", () => {
      const w = applyDerived(
        makeCharacter({
          id: "pc_w",
          name: "Lyra",
          className: "Wizard",
          level: 5,
          proficiencyBonus: 3,
          abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
          spells: ["Fire Bolt", "Fireball"],
          attacks: [{ name: "Fire Bolt", toHit: 6, damage: "2d10 fire" }],
        }),
        rulesCtx().classData("Wizard"),
      );
      const s = stateWith(fighter(), w);
      const r = run(s, { target_id: "pc_f", amount: 20, damage_type: "fire", source_id: "pc_w" });
      expect(hit(r.outcome.effects).style).toBeUndefined();
    });

    it("the single-attack fallback still applies when the damage type matches", () => {
      const s = stateWith(fighter());
      s.monsters.push({ ...wyrmling(), attacks: [{ name: "Longbow", toHit: 4, damage: "1d8+2 piercing", description: "Ranged Attack Roll" }] });
      const r = run(s, { target_id: "pc_f", amount: 6, damage_type: "Piercing", source_id: "m_drg" });
      expect(hit(r.outcome.effects)).toMatchObject({ style: "ranged", label: "Longbow" });
    });
  });
});
