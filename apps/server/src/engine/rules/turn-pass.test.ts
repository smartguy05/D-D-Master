import { describe, expect, it } from "vitest";
import { Monster, type Character, type GameState } from "@dm/shared";
import { executeEngineTool, type EngineTool } from "../tools.js";
import { stalledTurn } from "../turns.js";
import { makeCharacter, rulesCtx, seq, stateWith } from "./testing.js";

/**
 * A PC who can't take the turn they start (Dead after their death save, or still unconscious at
 * 0 HP) passes it on automatically: the DM was left waiting on a player who could not act.
 */

const run = (s: GameState, name: EngineTool, args: unknown, rng = seq(15)) => executeEngineTool(s, name, args, rulesCtx(rng));
const pc = (s: GameState, id: string) => s.characters.find((c) => c.id === id)!;
type TurnOut = {
  current?: string;
  next_turn?: string;
  passed?: { name: string; state: string; death_save?: { dead?: boolean } }[];
  death_save?: { dead?: boolean };
  instruction?: string;
};

const ana = (over: Partial<Character> = {}) => makeCharacter({ id: "pc_a", name: "Ana", maxHp: 20, hp: 20, ...over });
const bo = (over: Partial<Character> = {}) => makeCharacter({ id: "pc_b", name: "Bo", maxHp: 20, hp: 20, ...over });
const downed = (failures: number) => ({ hp: 0, conditions: ["Unconscious"], deathSaves: { successes: 0, failures, stable: false, lastRolled: null } });

/** Order: Goblin, then Ana, then Bo; the Goblin's turn is open. */
function fight(...chars: Character[]): GameState {
  const s = stateWith(...chars);
  s.monsters.push(Monster.parse({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13 }));
  s.combat = {
    active: true,
    round: 1,
    turnIndex: 0,
    order: [
      { entityId: "m1", entityType: "monster", name: "Goblin", initiative: 20 },
      ...chars.map((c, i) => ({ entityId: c.id, entityType: "character" as const, name: c.name, initiative: 15 - i })),
    ],
    turn: null,
    reactionsUsed: [],
    announced: [],
  };
  return s;
}

const current = (s: GameState) => s.combat.order[s.combat.turnIndex].entityId;

describe("a downed PC's turn passes on after their death save", () => {
  it("a third failed save on next_turn: Dead, and the next creature's turn starts", () => {
    const r = run(fight(ana(downed(2)), bo()), "next_turn", {}, seq(5));
    const out = r.outcome.output as TurnOut;
    expect(pc(r.state, "pc_a").conditions).toContain("Dead");
    expect(current(r.state)).toBe("pc_b");
    expect(out.current).toBe("Bo");
    expect(out.passed).toEqual([expect.objectContaining({ name: "Ana", state: "dead", death_save: expect.objectContaining({ dead: true }) })]);
    expect(out.instruction).toMatch(/Ana/);
    expect(r.outcome.moments.some((m) => m.kind === "turn_start" && m.targetId === "pc_b")).toBe(true);
  });

  it("a non-20 save that leaves the PC unconscious passes the turn too", () => {
    const r = run(fight(ana(downed(0)), bo()), "next_turn", {}, seq(12));
    const out = r.outcome.output as TurnOut;
    expect(pc(r.state, "pc_a").deathSaves.successes).toBe(1);
    expect(current(r.state)).toBe("pc_b");
    expect(out.passed?.[0]).toMatchObject({ name: "Ana", state: "unconscious" });
  });

  it("a natural 20 brings the PC back: the turn stays theirs", () => {
    const r = run(fight(ana(downed(1)), bo()), "next_turn", {}, seq(20));
    expect(pc(r.state, "pc_a").hp).toBe(1);
    expect(current(r.state)).toBe("pc_a");
    expect((r.outcome.output as TurnOut).passed).toBeUndefined();
  });

  it("two downed PCs in a row are both passed, back to the Goblin's next round", () => {
    const r = run(fight(ana(downed(0)), bo(downed(0))), "next_turn", {}, seq(12));
    const out = r.outcome.output as TurnOut;
    expect(out.passed?.map((p) => p.name)).toEqual(["Ana", "Bo"]);
    expect(current(r.state)).toBe("m1");
    expect(r.state.combat.round).toBe(2);
  });

  it("stops after one lap when nobody can act (no endless loop)", () => {
    const s = fight(ana(downed(0)), bo(downed(0)));
    s.monsters[0].hp = 0;
    s.monsters[0].conditions.push("Dead");
    const r = run(s, "next_turn", {}, seq(12));
    expect(((r.outcome.output as TurnOut).passed ?? []).length).toBeLessThanOrEqual(2);
  });

  it("physical dice: the turn waits for the d20, then passes once the save is recorded", () => {
    let s = fight(ana({ ...downed(2), diceMode: "physical" }), bo());
    const asked = run(s, "next_turn", {});
    s = asked.state;
    expect(current(s)).toBe("pc_a"); // waiting on Ana's real d20
    expect((asked.outcome.output as TurnOut).passed).toBeUndefined();
    const rec = run(s, "record_physical_roll", { character_id: "pc_a", notation: "1d20", label: "Death saving throw", total: 4, kind: "death_save" });
    const out = rec.outcome.output as TurnOut;
    expect(pc(rec.state, "pc_a").conditions).toContain("Dead");
    expect(current(rec.state)).toBe("pc_b");
    expect(out.next_turn).toBe("Bo");
    expect(out.passed?.[0]).toMatchObject({ name: "Ana", state: "dead" });
  });

  it("a death save recorded out of turn order does not move the turn", () => {
    const s = fight(ana({ ...downed(0), diceMode: "physical" }), bo());
    const rec = run(s, "record_physical_roll", { character_id: "pc_a", notation: "1d20", label: "Death saving throw", total: 12, kind: "death_save" });
    expect(current(rec.state)).toBe("m1");
    expect((rec.outcome.output as TurnOut).passed).toBeUndefined();
  });
});

describe("stalledTurn: a turn held by a PC who can't act", () => {
  it("nudges the DM to call next_turn when the turn sits on a dead PC", () => {
    const s = fight(ana({ hp: 0, conditions: ["Dead"] }), bo());
    s.combat.turnIndex = 1;
    expect(stalledTurn(s)?.prompt).toMatch(/Ana.*next_turn/);
  });

  it("stays quiet on a conscious PC's turn and while a downed PC's physical save is pending", () => {
    const s = fight(ana({ ...downed(0), diceMode: "physical" }), bo());
    s.combat.turnIndex = 2;
    expect(stalledTurn(s)).toBeUndefined();
    s.combat.turnIndex = 1;
    s.pendingRoll = { characterId: "pc_a", notation: "1d20", label: "Death saving throw", dc: 10, kind: "death_save" };
    expect(stalledTurn(s)).toBeUndefined();
  });
});
