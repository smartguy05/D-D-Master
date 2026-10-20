import { afterEach, describe, expect, it, vi } from "vitest";
import { GameState, ToolArgs, type Monster } from "@dm/shared";
import { doubleDice, executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./rules/testing.js";

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

/** Out of combat (no turn economy): Thorin (virtual dice, AC 16), Lyra (physical dice, AC 12) and a Goblin (AC 13). */
function party(): GameState {
  const s = stateWith(
    makeCharacter({ id: "pc_f", name: "Thorin", ac: 16 }),
    makeCharacter({ id: "pc_l", name: "Lyra", ac: 12, diceMode: "physical" }),
  );
  s.monsters.push(goblin());
  return s;
}

function run(s: GameState, name: EngineTool, args: unknown, c: EngineContext = rulesCtx(seq(5))) {
  const r = executeEngineTool(s, name, args, c);
  return { state: r.state, out: r.outcome.output as Out, rolls: r.outcome.rolls, effects: r.outcome.effects };
}

describe("targeted d20 rolls default their DC to the target's AC", () => {
  it("roll_dice: a d20 roll at a monster is checked against its AC (5+5 = 10 vs AC 13: miss)", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+5", label: "Longsword attack", roller_id: "pc_f", target_id: "m1", attack_name: "Longsword" });
    expect(r.rolls[0]).toMatchObject({ total: 10, dc: 13, success: false });
    expect(r.out).toMatchObject({ total: 10, success: false, vs_ac: 13 });
  });

  it("roll_dice: a monster's attack at a character uses the character's AC (15+5 = 20 vs AC 16: hit)", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+5", label: "Scimitar attack", roller_id: "m1", target_id: "pc_f" }, rulesCtx(seq(15)));
    expect(r.rolls[0]).toMatchObject({ total: 20, dc: 16, success: true });
    expect(r.out).toMatchObject({ success: true, vs_ac: 16 });
  });

  it("request_player_roll (virtual dice) with a target and no dc uses the target's AC", () => {
    const r = run(party(), "request_player_roll", { character_id: "pc_f", notation: "1d20+5", label: "Longsword attack", target_id: "m1" }, rulesCtx(seq(8)));
    expect(r.rolls[0]).toMatchObject({ total: 13, dc: 13, success: true });
    expect(r.out).toMatchObject({ character: "Thorin", success: true, vs_ac: 13 });
  });

  it("an explicit dc still wins over the AC (cover etc.)", () => {
    const r = run(party(), "roll_dice", { notation: "1d20+5", label: "attack", roller_id: "pc_f", target_id: "m1", dc: 15 }, rulesCtx(seq(9)));
    expect(r.rolls[0]).toMatchObject({ total: 14, dc: 15, success: false });
    expect(r.out.vs_ac).toBeUndefined();
  });

  it("leaves untargeted rolls and targeted damage rolls without a dc", () => {
    const plain = run(party(), "roll_dice", { notation: "1d20+2", label: "Perception", roller_id: "pc_f" });
    expect(plain.rolls[0].dc).toBeUndefined();
    expect(plain.rolls[0].success).toBeUndefined();
    expect(plain.out.vs_ac).toBeUndefined();
    const dmg = run(party(), "roll_dice", { notation: "1d8+3", label: "Longsword damage", roller_id: "pc_f", target_id: "m1" });
    expect(dmg.rolls[0].dc).toBeUndefined();
    expect(dmg.out.success).toBeUndefined();
    expect(dmg.out.vs_ac).toBeUndefined();
  });

  it("physical dice: the pending roll stores the target's AC and the recorded total is a hit or miss against it", () => {
    let s = run(party(), "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }).state;
    expect(s.pendingRoll).toMatchObject({ characterId: "pc_l", targetId: "m1", dc: 13 });
    const hit = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 15 });
    expect(hit.out).toMatchObject({ total: 15, success: true });
    expect(hit.rolls[0]).toMatchObject({ dc: 13, success: true });

    s = run(party(), "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }).state;
    const miss = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 9 });
    expect(miss.out).toMatchObject({ total: 9, success: false });
  });
});

describe("a physical roll the host already recorded is not recorded again by the DM", () => {
  afterEach(() => void vi.useRealTimers());

  const host = (): EngineContext => ({ ...rulesCtx(seq(5)), source: "host" });
  const dm = (): EngineContext => ({ ...rulesCtx(seq(5)), source: "dm" });
  const record = (total: number) => ({ character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total });

  /** Lyra's attack was asked for, then the host (phone/Play tab) recorded 17. */
  function recorded(): GameState {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T20:00:00Z"));
    let s = run(party(), "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }, dm()).state;
    s = run(s, "record_physical_roll", record(17), host()).state;
    expect(s.pendingRoll).toBeUndefined();
    return s;
  }

  it("a DM record_physical_roll with the same total within 10 s is reported as already recorded and changes nothing", () => {
    const s = recorded();
    vi.setSystemTime(new Date("2026-10-19T20:00:03Z"));
    const r = run(s, "record_physical_roll", record(17), dm());
    expect(r.out).toMatchObject({ already_recorded: true });
    expect(r.rolls).toHaveLength(0);
    expect(r.effects).toHaveLength(0);
    expect(r.state.rolls).toHaveLength(s.rolls.length);
    expect(r.state.log).toHaveLength(s.log.length);
  });

  it("a different total right after is the same roll misheard: reported, not added", () => {
    const s = recorded();
    vi.setSystemTime(new Date("2026-10-19T20:00:03Z"));
    const r = run(s, "record_physical_roll", record(12), dm());
    expect(r.out).toMatchObject({ already_recorded: true, recorded_total: 17 });
    expect(r.state.rolls).toHaveLength(s.rolls.length);
  });

  it("a DM record more than 15 s later is recorded normally", () => {
    const s = recorded();
    vi.setSystemTime(new Date("2026-10-19T20:00:16Z"));
    const r = run(s, "record_physical_roll", record(17), dm());
    expect(r.out.already_recorded).toBeUndefined();
    expect(r.state.rolls).toHaveLength(s.rolls.length + 1);
  });
});

describe("physical damage rolls (request_player_roll kind damage)", () => {
  const damageReq = (over = {}) => ({ character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage", ...over });
  const damageRecord = (total: number, over = {}) => ({ character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", total, ...over });

  /** Combat with Lyra (physical dice) on her turn, then the Goblin. */
  function lyraTurn(): GameState {
    const s = party();
    s.tokens.push(
      { id: "tok_pc_l", entityId: "pc_l", entityType: "character", x: 2, y: 2, size: 1 },
      { id: "tok_m1", entityId: "m1", entityType: "monster", x: 3, y: 2, size: 1 },
    );
    s.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      order: [
        { entityId: "pc_l", entityType: "character", name: "Lyra", initiative: 18 },
        { entityId: "m1", entityType: "monster", name: "Goblin", initiative: 10 },
      ],
      turn: null,
      reactionsUsed: [],
    } as GameState["combat"];
    return s;
  }

  it("physical dice: sets a pending damage roll at the target, no DC", () => {
    const r = run(party(), "request_player_roll", damageReq());
    expect(r.out.error).toBeUndefined();
    expect(r.state.pendingRoll).toMatchObject({ characterId: "pc_l", kind: "damage", targetId: "m1", notation: "1d8+3" });
    expect(r.state.pendingRoll?.dc).toBeUndefined();
    expect(r.rolls).toHaveLength(0);
  });

  it("recording the total applies it as damage to the target and clears the pending roll", () => {
    let s = run(party(), "request_player_roll", damageReq()).state;
    const r = run(s, "record_physical_roll", damageRecord(5));
    expect(r.out).toMatchObject({ damage_applied: 5, target: "Goblin" });
    expect(r.out.success).toBeUndefined();
    expect(r.out.dc).toBeUndefined();
    expect(r.state.monsters[0].hp).toBe(2);
    expect(r.state.pendingRoll).toBeUndefined();
    s = run(r.state, "request_player_roll", damageReq()).state;
    const kill = run(s, "record_physical_roll", damageRecord(9));
    expect(kill.out).toMatchObject({ damage_applied: 9, target: "Goblin" });
    expect(kill.state.monsters[0].hp).toBe(0);
  });

  it("accepts critical on record_physical_roll for a damage roll", () => {
    const s = run(party(), "request_player_roll", damageReq()).state;
    const r = run(s, "record_physical_roll", damageRecord(4, { critical: true }));
    expect(r.out.error).toBeUndefined();
    expect(r.out).toMatchObject({ damage_applied: 4 });
    expect(r.state.monsters[0].hp).toBe(3);
  });

  it("in combat the damage request after an attack spends no action and is not refused", () => {
    let s = lyraTurn();
    s = run(s, "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Longsword attack", target_id: "m1", attack_name: "Longsword" }).state;
    s = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Longsword attack", total: 18 }).state;
    const before = JSON.stringify(s.combat);
    const r = run(s, "request_player_roll", damageReq());
    expect(r.out.error).toBeUndefined();
    expect(r.state.pendingRoll).toMatchObject({ kind: "damage", targetId: "m1" });
    expect(JSON.stringify(r.state.combat)).toBe(before);
    const rec = run(r.state, "record_physical_roll", damageRecord(6));
    expect(rec.out).toMatchObject({ damage_applied: 6 });
    expect(rec.state.monsters[0].hp).toBe(1);
  });

  it("virtual dice: a damage request just rolls and returns the total, with no AC check", () => {
    const r = run(party(), "request_player_roll", { ...damageReq(), character_id: "pc_f" }, rulesCtx(seq(5)));
    expect(r.out.error).toBeUndefined();
    expect(r.rolls).toHaveLength(1);
    expect(r.rolls[0].dc).toBeUndefined();
    expect(r.out).toMatchObject({ total: 8 });
    expect(r.out.vs_ac).toBeUndefined();
    expect(r.state.pendingRoll).toBeUndefined();
  });
});

describe("physical damage roll edge cases", () => {
  const damageReq = (over = {}) => ({ character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage", ...over });

  it("a negative total recorded for a damage roll does not heal the target", () => {
    const s = run(party(), "request_player_roll", damageReq()).state;
    s.monsters[0].hp = 4;
    let hp: number | undefined;
    try {
      hp = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", total: -3 }).state.monsters[0].hp;
    } catch {
      hp = 4; // refusing is fine too
    }
    expect(hp).toBeLessThanOrEqual(4);
  });

  it("replacing a pending damage roll does not call it a concentration save", () => {
    const s = run(party(), "request_player_roll", damageReq()).state;
    const r = run(s, "request_player_roll", { character_id: "pc_l", notation: "1d20+2", label: "Perception check" });
    expect(String(r.out.replaced ?? "")).not.toMatch(/concentration/i);
  });

  it("virtual dice: a damage roll with target_id does not play a second attack animation", () => {
    const r = run(party(), "request_player_roll", { ...damageReq(), character_id: "pc_f" }, rulesCtx(seq(5)));
    expect(r.effects.filter((e) => e.kind === "attack")).toHaveLength(0);
  });

  it("a d20 check recorded with explicit kind check is not applied as the pending damage", () => {
    const s = run(party(), "request_player_roll", damageReq()).state;
    let hp = 7;
    try {
      hp = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+2", label: "Perception check", total: 15, kind: "check" }).state.monsters[0].hp;
    } catch {
      /* refusing is fine */
    }
    expect(hp).toBe(7);
  });

  it("removing the targeted monster does not leave the damage prompt stuck on the TV and phone", () => {
    const s = run(party(), "request_player_roll", damageReq()).state;
    const r = run(s, "remove_monster", { monster_id: "m1" });
    expect(r.state.pendingRoll).toBeUndefined();
  });
});

describe("physical damage rolls: code-review follow-ups", () => {
  const req = { character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage" };

  it("a check recorded with kind check meanwhile keeps the damage prompt and says so", () => {
    let s = run(party(), "request_player_roll", req).state;
    const r = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+2", label: "Perception", total: 15, kind: "check" });
    expect(r.state.pendingRoll).toMatchObject({ kind: "damage", targetId: "m1" });
    expect(String((r.out as { warning?: string }).warning)).toMatch(/damage roll .* still waiting/);
    expect(r.state.monsters[0].hp).toBe(s.monsters[0].hp);
  });

  it("a virtual player's roll doesn't wipe another player's pending physical roll", () => {
    let s = run(party(), "request_player_roll", req).state;
    s = run(s, "request_player_roll", { character_id: "pc_f", notation: "1d20+5", label: "Athletics check" }).state;
    expect(s.pendingRoll).toMatchObject({ characterId: "pc_l", kind: "damage" });
  });

  it("removing the target tells the DM the pending roll was cancelled", () => {
    const s = run(party(), "request_player_roll", req).state;
    const r = run(s, "remove_monster", { monster_id: "m1" });
    expect(String((r.out as { dropped_roll?: string }).dropped_roll)).toMatch(/Lyra's pending Longsword damage/);
  });
});

describe("critical damage on a physical damage roll (request_player_roll critical)", () => {
  afterEach(() => void vi.useRealTimers());

  const damageReq = (over = {}) => ({ character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage", ...over });
  const attackReq = { character_id: "pc_l", notation: "1d20+4", label: "Longsword attack", target_id: "m1", attack_name: "Longsword" };
  const attackRecord = (total: number, natural?: number) => ({ character_id: "pc_l", notation: "1d20+4", label: "Longsword attack", total, natural });

  /** party() with Thorin down: 0 HP, Unconscious, no death saves yet. */
  function downedThorin(): GameState {
    const s = party();
    const t = s.characters.find((c) => c.id === "pc_f")!;
    t.hp = 0;
    t.conditions = ["Unconscious"];
    t.deathSaves = { ...t.deathSaves, successes: 0, failures: 0, stable: false };
    return s;
  }

  /** Lyra's attack was asked for and recorded (natural given when she says it). */
  function afterAttack(total: number, natural?: number, s: GameState = party()): GameState {
    s = run(s, "request_player_roll", attackReq).state;
    return run(s, "record_physical_roll", attackRecord(total, natural)).state;
  }

  it("critical: true is stored on the pending damage roll and the instruction says to roll the dice twice", () => {
    const r = run(party(), "request_player_roll", damageReq({ critical: true }));
    expect(r.out.error).toBeUndefined();
    expect(r.state.pendingRoll).toMatchObject({ kind: "damage", targetId: "m1", critical: true });
    expect(String(r.out.instruction)).toMatch(/twice/i);
  });

  it("a damage request right after a natural 20 attack is inferred to be critical", () => {
    const s = afterAttack(24, 20);
    const r = run(s, "request_player_roll", damageReq());
    expect(r.state.pendingRoll?.critical).toBe(true);
  });

  it("a damage request after a normal hit is not critical", () => {
    const s = afterAttack(18);
    const r = run(s, "request_player_roll", damageReq());
    expect(r.state.pendingRoll?.critical).toBeFalsy();
    expect(String(r.out.instruction)).not.toMatch(/twice/i);
  });

  it("a natural 20 from more than 2 minutes ago is not inferred", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T20:00:00Z"));
    const s = afterAttack(24, 20);
    vi.setSystemTime(new Date("2026-10-20T20:02:30Z"));
    const r = run(s, "request_player_roll", damageReq());
    expect(r.state.pendingRoll?.critical).toBeFalsy();
  });

  it("an explicit critical: false overrides the inference", () => {
    const s = afterAttack(24, 20);
    const r = run(s, "request_player_roll", damageReq({ critical: false }));
    expect(r.state.pendingRoll?.critical).toBeFalsy();
  });

  it("record_physical_roll without critical uses the pending roll's critical: 2 death-save failures on a downed PC", () => {
    const s = run(downedThorin(), "request_player_roll", damageReq({ target_id: "pc_f", critical: true })).state;
    const r = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", total: 7 });
    expect(r.out.error).toBeUndefined();
    expect(r.state.characters.find((c) => c.id === "pc_f")!.deathSaves.failures).toBe(2);
  });

  it("an explicit critical: false on record_physical_roll wins over the pending critical: 1 failure", () => {
    const s = run(downedThorin(), "request_player_roll", damageReq({ target_id: "pc_f", critical: true })).state;
    const r = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", total: 7, critical: false });
    expect(r.state.characters.find((c) => c.id === "pc_f")!.deathSaves.failures).toBe(1);
  });
});

describe("critical on request_player_roll and the pending roll (schemas)", () => {
  it("ToolArgs.request_player_roll keeps critical: true", () => {
    const a = ToolArgs.request_player_roll.parse({ character_id: "pc_l", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage", critical: true });
    expect((a as { critical?: boolean }).critical).toBe(true);
  });

  it("GameState.pendingRoll keeps critical", () => {
    const s = party();
    const parsed = GameState.parse({ ...s, pendingRoll: { characterId: "pc_l", notation: "1d8+3", label: "Longsword damage", kind: "damage", targetId: "m1", critical: true } });
    expect((parsed.pendingRoll as { critical?: boolean } | undefined)?.critical).toBe(true);
  });
});

describe("critical inference only after an attack roll", () => {
  const damageReq = { character_id: "pc_l", notation: "1d8+3", label: "Fire Bolt damage", target_id: "m1", kind: "damage" };

  it("a natural 20 skill check (no target) does not make the next damage roll critical", () => {
    let s = run(party(), "request_player_roll", { character_id: "pc_l", notation: "1d20+3", label: "Stealth check" }).state;
    s = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+3", label: "Stealth check", total: 23, natural: 20 }).state;
    const r = run(s, "request_player_roll", damageReq);
    expect(r.state.pendingRoll?.critical).toBeFalsy();
    expect(String(r.out.instruction)).not.toMatch(/twice/i);
  });

  it("a natural 20 saving throw (dc, no target) does not make the next damage roll critical", () => {
    let s = run(party(), "request_player_roll", { character_id: "pc_l", notation: "1d20+2", label: "Dexterity save", dc: 13 }).state;
    s = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+2", label: "Dexterity save", total: 22, natural: 20 }).state;
    const r = run(s, "request_player_roll", damageReq);
    expect(r.state.pendingRoll?.critical).toBeFalsy();
  });
});

describe("critical damage: code-review follow-ups", () => {
  it("doubleDice doubles the dice, not the modifier", () => {
    expect(doubleDice("1d8+3")).toBe("2d8+3");
    expect(doubleDice("2d6+1d4+2")).toBe("4d6+2d4+2");
    expect(doubleDice("d10")).toBe("2d10");
  });

  it("virtual dice: a critical damage roll rolls the dice twice and the hint says critical", () => {
    const r = run(party(), "request_player_roll", { character_id: "pc_f", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage", critical: true });
    expect(r.rolls[0].notation).toBe("2d8+3");
    expect(String((r.out as { hint?: string }).hint)).toMatch(/critical: true/);
  });

  it("a natural 20 at one creature doesn't make damage against another critical", () => {
    let s = party();
    s.monsters.push({ ...s.monsters[0], id: "m2", name: "Goblin 2" });
    s = run(s, "request_player_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", target_id: "m1" }).state;
    s = run(s, "record_physical_roll", { character_id: "pc_l", notation: "1d20+4", label: "Dagger attack", total: 24, natural: 20 }).state;
    s = run(s, "request_player_roll", { character_id: "pc_l", notation: "1d4+2", label: "Dagger damage", target_id: "m2", kind: "damage" }).state;
    expect(s.pendingRoll?.critical).toBeFalsy();
  });
});
