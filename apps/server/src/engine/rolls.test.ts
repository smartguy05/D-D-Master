import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState, Monster } from "@dm/shared";
import { executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";
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
