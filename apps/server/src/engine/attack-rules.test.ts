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

// ---- Phase 1: line of sight and cover for attacks (A1-A4) ----

type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
const wseg = (id: string, x1: number, y1: number, x2: number, y2: number, kind: Seg["kind"] = "wall", open = false): Seg => ({ id, x1, y1, x2, y2, kind, open });
const FULL_WALL = [wseg("w1", 4, 0, 4, 10)]; // x=4, top to bottom
const STUB = [wseg("w1", 4, 0, 4, 2)]; // half cover for (2,1) -> (6,2)
const CORNER = [wseg("w1", 6, 0, 6, 3)]; // three-quarters for (2,3) -> (6,2)

function roomCtx(walls: Seg[], rng = seq(10), features: unknown[] = []): EngineContext {
  const room = { id: "loc_room", name: "Room", description: "", mapPrompt: "", fog: false, gridW: 12, gridH: 10, features, walls } as unknown as EngineContext["locations"][number];
  return { ...rulesCtx(rng), locations: [room] };
}

/** party() in the room, with tokens at the given cells (omit an id to leave it off the board). */
function placed(pos: Partial<Record<"pc_f" | "pc_l" | "m1", [number, number]>>, monster: Partial<Monster> = {}): GameState {
  const s = party(monster);
  s.locationId = "loc_room";
  for (const [id, xy] of Object.entries(pos)) {
    const type = id === "m1" ? "monster" : "character";
    s.tokens.push({ id: `tok_${id}`, entityId: id, entityType: type, x: xy![0], y: xy![1], size: 1 });
  }
  return s;
}

describe("attacks need line of sight (A1)", () => {
  it("roll_dice through a full wall is refused: no roll, no log line, no effect", () => {
    const s = placed({ pc_f: [2, 2], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+5", label: "Longsword attack", roller_id: "pc_f", target_id: "m1", attack_name: "Longsword" }, roomCtx(FULL_WALL));
    expect(r.out).toEqual({ error: "Thorin has no line of sight to Goblin: a wall or closed door blocks it. Choose another target or move first." });
    expect(r.rolls).toEqual([]);
    expect(r.effects).toEqual([]);
    expect(r.state.rolls).toHaveLength(s.rolls.length);
    expect(r.state.log).toHaveLength(s.log.length);
  });

  it("a monster attacking through a closed door is refused too", () => {
    const s = placed({ pc_f: [2, 2], m1: [6, 2] });
    const door = [wseg("w1", 4, 0, 4, 2), wseg("d1", 4, 2, 4, 3, "door", false), wseg("w2", 4, 3, 4, 10)];
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "Scimitar attack", roller_id: "m1", target_id: "pc_f" }, roomCtx(door));
    expect(r.out.error).toBe("Goblin has no line of sight to Thorin: a wall or closed door blocks it. Choose another target or move first.");
    expect(r.rolls).toEqual([]);
    // the door open: the attack goes ahead
    const opened = [wseg("w1", 4, 0, 4, 2), wseg("d1", 4, 2, 4, 3, "door", true), wseg("w2", 4, 3, 4, 10)];
    const ok = run(s, "roll_dice", { notation: "1d20+4", label: "Scimitar attack", roller_id: "m1", target_id: "pc_f" }, roomCtx(opened));
    expect(ok.out.error).toBeUndefined();
    expect(ok.rolls).toHaveLength(1);
  });

  it("an explicit dc does not bypass total cover", () => {
    const s = placed({ pc_f: [2, 2], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+5", label: "attack", roller_id: "pc_f", target_id: "m1", dc: 12 }, roomCtx(FULL_WALL));
    expect(r.out.error).toMatch(/no line of sight/);
    expect(r.rolls).toEqual([]);
  });
});

describe("cover raises the target's AC (A2)", () => {
  it("half cover: vs_ac = AC + 2, judged against the raised AC, stored on the roll", () => {
    const s = placed({ pc_f: [2, 1], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(STUB, seq(10)));
    expect(r.out).toMatchObject({ vs_ac: 15, cover: "half", cover_bonus: 2, total: 14, success: false });
    expect(r.rolls[0]).toMatchObject({ dc: 15, success: false, cover: "half" });
  });

  it("the host log's roll line shows the raised AC and the cover (W4)", () => {
    const s = placed({ pc_f: [2, 1], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(STUB, seq(10)));
    expect(r.state.log.at(-1)!.text).toBe("Thorin rolled attack: 14 vs AC 15 (half cover +2)");
    const physical = run(placed({ pc_l: [2, 1], m1: [6, 2] }), "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }, roomCtx(STUB)).state;
    const rec = run(physical, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 16 }, roomCtx(STUB));
    expect(rec.state.log.at(-1)!.text).toMatch(/rolled Dagger attack: 16 \(physical\) vs AC 15 \(half cover \+2\)$/);
  });

  it("three-quarters cover: vs_ac = AC + 5", () => {
    const s = placed({ pc_f: [2, 3], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+7", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(CORNER, seq(10)));
    expect(r.out).toMatchObject({ vs_ac: 18, cover: "three-quarters", cover_bonus: 5, success: false });
    expect(r.rolls[0]).toMatchObject({ dc: 18, cover: "three-quarters" });
  });

  it("a natural 20 still hits and a natural 1 still misses behind cover", () => {
    const s = placed({ pc_f: [2, 3], m1: [6, 2] }, { ac: 25 });
    const hit = run(s, "roll_dice", { notation: "1d20+2", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(CORNER, seq(20)));
    expect(hit.out).toMatchObject({ natural20: true, success: true, vs_ac: 30 });
    const s2 = placed({ pc_f: [2, 1], m1: [6, 2] });
    const miss = run(s2, "roll_dice", { notation: "1d20+30", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(STUB, seq(1)));
    expect(miss.out).toMatchObject({ natural1: true, success: false });
  });

  it("an explicit dc gets no cover bonus", () => {
    const s = placed({ pc_f: [2, 1], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1", dc: 12 }, roomCtx(STUB, seq(10)));
    expect(r.rolls[0]!.dc).toBe(12);
    expect(r.out.success).toBe(true);
    expect(r.out.cover_bonus).toBeUndefined();
  });

  it("a creature in between gives half cover (no walls at all)", () => {
    const s = placed({ pc_f: [0, 2], pc_l: [2, 2], m1: [4, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx([], seq(10)));
    expect(r.out).toMatchObject({ vs_ac: 15, cover: "half", cover_bonus: 2 });
  });

  it("a blocking feature in between gives half cover", () => {
    const pews = { name: "pews", kind: "feature", lit: false, blocks: true, x: 2, y: 2, w: 1, h: 1 };
    const s = placed({ pc_f: [0, 2], m1: [4, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx([], seq(10), [pews]));
    expect(r.out).toMatchObject({ vs_ac: 15, cover: "half" });
  });

  it("nothing in the way: plain AC and no cover fields", () => {
    const s = placed({ pc_f: [2, 2], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx([], seq(10)));
    expect(r.out.vs_ac).toBe(13);
    expect(r.out.cover).toBeUndefined();
    expect(r.rolls[0]!.cover).toBeUndefined();
  });
});

describe("request_player_roll attacks and cover (A3)", () => {
  it("total cover: an error and no pending roll, on virtual and physical dice", () => {
    const s = placed({ pc_f: [2, 2], pc_l: [2, 3], m1: [6, 2] });
    const v = run(s, "request_player_roll", { character_id: "pc_f", notation: "1d20+5", label: "Longsword attack", target_id: "m1" }, roomCtx(FULL_WALL));
    expect(v.out.error).toBe("Thorin has no line of sight to Goblin: a wall or closed door blocks it. Choose another target or move first.");
    expect(v.rolls).toEqual([]);
    const p = run(s, "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }, roomCtx(FULL_WALL));
    expect(p.out.error).toMatch(/^Lyra has no line of sight to Goblin/);
    expect(p.state.pendingRoll).toBeUndefined();
  });

  it("virtual dice: half cover raises vs_ac and the result carries cover", () => {
    const s = placed({ pc_f: [2, 1], m1: [6, 2] });
    const r = run(s, "request_player_roll", { character_id: "pc_f", notation: "1d20+4", label: "Longsword attack", target_id: "m1" }, roomCtx(STUB, seq(10)));
    expect(r.out).toMatchObject({ vs_ac: 15, cover: "half", success: false });
    expect(r.rolls[0]).toMatchObject({ dc: 15, cover: "half" });
  });

  it("physical dice: the pending dc is the cover-raised AC, and record_physical_roll judges against it", () => {
    const c = roomCtx(STUB);
    const s = run(placed({ pc_l: [2, 1], m1: [6, 2] }), "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }, c).state;
    expect(s.pendingRoll).toMatchObject({ dc: 15 });
    const miss = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 14 }, c);
    expect(miss.out.success).toBe(false);
    const hit = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 15 }, c);
    expect(hit.out.success).toBe(true);
  });

  it("damage rolls and saves/checks never get a line-of-sight check", () => {
    const s = placed({ pc_f: [2, 2], pc_l: [2, 3], m1: [6, 2] });
    const c = roomCtx(FULL_WALL);
    const dmg = run(s, "request_player_roll", { character_id: "pc_f", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage" }, c);
    expect(dmg.out.error).toBeUndefined();
    expect(dmg.rolls).toHaveLength(1);
    const pdmg = run(s, "request_player_roll", { character_id: "pc_l", notation: "1d4+2", label: "Dagger damage", target_id: "m1", kind: "damage" }, c);
    expect(pdmg.out.error).toBeUndefined();
    expect(pdmg.state.pendingRoll).toMatchObject({ kind: "damage" });
    const save = run(s, "request_player_roll", { character_id: "pc_f", notation: "1d20+2", label: "Dexterity save", target_id: "m1", dc: 12 }, c);
    expect(save.out.error).toBeUndefined();
    expect(save.rolls).toHaveLength(1);
  });
});

describe("theatre of mind keeps today's behaviour (A4)", () => {
  it("no LOS or cover check when the roller has no token", () => {
    const s = placed({ m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(FULL_WALL, seq(10)));
    expect(r.out.error).toBeUndefined();
    expect(r.out.vs_ac).toBe(13);
    expect(r.out.cover).toBeUndefined();
  });

  it("no check when the target has no token, or a token is off the board at -1,-1", () => {
    const noTarget = placed({ pc_f: [2, 2] });
    expect(run(noTarget, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(FULL_WALL)).out.vs_ac).toBe(13);
    const off = placed({ pc_f: [2, 2], m1: [-1, -1] });
    const r = run(off, "roll_dice", { notation: "1d20+4", label: "attack", roller_id: "pc_f", target_id: "m1" }, roomCtx(FULL_WALL));
    expect(r.out.error).toBeUndefined();
    expect(r.out.vs_ac).toBe(13);
  });

  it("no check without a roller_id", () => {
    const s = placed({ pc_f: [2, 2], m1: [6, 2] });
    const r = run(s, "roll_dice", { notation: "1d20+4", label: "attack", target_id: "m1" }, roomCtx(FULL_WALL));
    expect(r.out.error).toBeUndefined();
    expect(r.rolls).toHaveLength(1);
  });
});
