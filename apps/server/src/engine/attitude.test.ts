import { describe, expect, it } from "vitest";
import { Character, emptyGameState, Monster, type GameState, type Rng } from "@dm/shared";
import { ENGINE_TOOLS, executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";

/**
 * adjust_attitude (Phase 4): a gradual -5..+5 attitude score per NPC/monster on the 2024 SRD
 * attitudes. Crossing a threshold (<= -3 hostile, -2..+2 indifferent, >= +3 friendly) applies the
 * same disposition logic as set_disposition; set_disposition stays the hard override and syncs it.
 */

const seq =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

function ctx(rng: Rng = seq(10)): EngineContext {
  return {
    rng,
    monsterTemplate: () => undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [{ id: "loc_shore", name: "Shore", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 12, gridH: 8 }],
  };
}

const run = (s: GameState, tool: string, args: unknown, rng?: Rng) => executeEngineTool(s, tool as EngineTool, args, ctx(rng));
type Out = Record<string, unknown> & { error?: string };

function refusal(fn: () => ReturnType<typeof run>): string {
  try {
    return String((fn().outcome.output as Out | null)?.error ?? "");
  } catch (e) {
    return (e as Error).message;
  }
}

const mon = (over: Record<string, unknown> & { id: string; name: string }) => Monster.parse({ maxHp: 7, hp: 7, ac: 12, ...over });
const m = (s: GameState, id: string) => s.monsters.find((x) => x.id === id) as (Monster & Record<string, unknown>) | undefined;

/** Bram (PC); Kobold 1 and 2 (foes); Tikk (neutral story NPC); Pell (friendly story NPC). */
function base(): GameState {
  const s = emptyGameState("c1");
  s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Bram", maxHp: 12, hp: 12 }));
  s.monsters.push(
    mon({ id: "m1", name: "Kobold 1" }),
    mon({ id: "m2", name: "Kobold 2" }),
    mon({ id: "m3", name: "Tikk", npc: true, neutral: true, combatant: false }),
    mon({ id: "m4", name: "Pell Netter", npc: true, ally: true, combatant: false }),
  );
  return s;
}

/** Bram 20, Kobold 1 15, Kobold 2 10. turnIndex picks whose turn it is. Tikk and Pell are not in the order. */
function fight(turnIndex = 2): GameState {
  const s = base();
  s.combat = {
    active: true,
    round: 1,
    turnIndex,
    order: [
      { entityId: "pc_a", entityType: "character", name: "Bram", initiative: 20 },
      { entityId: "m1", entityType: "monster", name: "Kobold 1", initiative: 15 },
      { entityId: "m2", entityType: "monster", name: "Kobold 2", initiative: 10 },
    ],
    turn: null,
    reactionsUsed: [],
    announced: [],
  };
  return s;
}

const adjust = (s: GameState, npc_id: string, delta: number, reason = "a kind word", rng?: Rng) => run(s, "adjust_attitude", { npc_id, delta, reason }, rng);
const attitudeMoments = (r: ReturnType<typeof run>) => r.outcome.moments.filter((x) => (x.kind as string) === "attitude");
const lastLog = (s: GameState) => s.log[s.log.length - 1];

describe("adjust_attitude: plumbing and refusals", () => {
  it("is an engine tool", () => {
    expect(ENGINE_TOOLS as readonly string[]).toContain("adjust_attitude");
  });

  it("refuses a player character id and an unknown id", () => {
    expect(refusal(() => adjust(base(), "pc_a", 1))).toMatch(/.+/);
    expect(refusal(() => adjust(base(), "mon_gone", 1))).toMatch(/mon_gone|unknown|no .*creature/i);
  });

  it("rejects delta 0 / out of range before running", () => {
    expect(() => adjust(base(), "m3", 0)).toThrow();
    expect(() => adjust(base(), "m3", 6)).toThrow();
    expect(() => adjust(base(), "m3", -6)).toThrow();
  });

  it("is pure: the input state is not mutated", () => {
    const s = base();
    const before = JSON.stringify(s);
    adjust(s, "m3", 4, "saved his dog");
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("adjust_attitude: moving within a band", () => {
  it("score 0 +2 -> 2: stores the score, flags and order unchanged, logs the move and reason, no moment", () => {
    const s = fight();
    const r = adjust(s, "m3", 2, "shared his rum");
    const t = m(r.state, "m3")!;
    expect(t.attitudeScore).toBe(2);
    expect(t.attitude).toBe("indifferent");
    expect(t).toMatchObject({ ally: false, neutral: true, combatant: false });
    expect(r.state.combat.order).toEqual(s.combat.order);
    expect(r.state.combat.turnIndex).toBe(s.combat.turnIndex);
    const log = lastLog(r.state);
    expect(log.text).toContain("Tikk");
    expect(log.text).toContain("shared his rum");
    expect(log.text).toMatch(/2/);
    expect(attitudeMoments(r)).toEqual([]);
    expect(r.outcome.output).toMatchObject({ name: "Tikk", attitude: "indifferent", score: 2, previous_attitude: "indifferent", changed: false });
  });

  it("a friendly NPC at +4 insulted (-1) stays friendly at +3", () => {
    const s = base();
    m(s, "m4")!.attitudeScore = 4;
    const r = adjust(s, "m4", -1, "mocked his boat");
    expect(m(r.state, "m4")).toMatchObject({ attitudeScore: 3, attitude: "friendly", ally: true, neutral: false, combatant: false });
    expect(attitudeMoments(r)).toEqual([]);
  });
});

describe("adjust_attitude: crossing a threshold", () => {
  it("indifferent -> friendly: ally, combatant left false for a story NPC; log line and moment", () => {
    const r = adjust(base(), "m3", 3, "saved his dog");
    const t = m(r.state, "m3")!;
    expect(t).toMatchObject({ attitudeScore: 3, attitude: "friendly", ally: true, neutral: false, combatant: false });
    const log = lastLog(r.state);
    expect(log.kind).toBe("system");
    expect(log.text).toBe("Tikk is now Friendly (+3): saved his dog");
    expect(attitudeMoments(r)).toEqual([expect.objectContaining({ kind: "attitude", targetId: "m3", outcome: "friendly" })]);
    expect(r.outcome.output).toMatchObject({ name: "Tikk", attitude: "friendly", score: 3, previous_attitude: "indifferent", changed: true });
  });

  it("friendly keeps combatant true for a creature that already was one", () => {
    const s = base();
    m(s, "m1")!.attitudeScore = -1; // a kobold talked down to indifferent, flags still foe
    const r = adjust(s, "m1", 4, "paid tribute");
    expect(m(r.state, "m1")).toMatchObject({ attitude: "friendly", attitudeScore: 3, ally: true, neutral: false, combatant: true });
  });

  it("indifferent -> hostile out of combat: foe and combatant", () => {
    const r = adjust(base(), "m3", -3, "threatened his family");
    expect(m(r.state, "m3")).toMatchObject({ attitude: "hostile", attitudeScore: -3, ally: false, neutral: false, combatant: true });
    expect(lastLog(r.state).text).toBe("Tikk is now Hostile (-3): threatened his family");
    expect(attitudeMoments(r)).toEqual([expect.objectContaining({ targetId: "m3", outcome: "hostile" })]);
  });

  it("-> hostile mid-combat joins initiative at its rolled place; the turn stays put", () => {
    // Tikk rolls 12 (+0): between Kobold 1 (15) and Kobold 2 (10).
    const r = adjust(fight(), "m3", -4, "insulted", seq(12));
    expect(r.state.combat.order.map((o) => o.entityId)).toEqual(["pc_a", "m1", "m3", "m2"]);
    expect(r.state.combat.order[r.state.combat.turnIndex].entityId).toBe("m2");
  });

  it("-> hostile mid-combat: a creature at 0 HP doesn't join", () => {
    const s = fight();
    m(s, "m3")!.hp = 0;
    const r = adjust(s, "m3", -3, "insulted");
    expect(r.state.combat.order.map((o) => o.entityId)).not.toContain("m3");
  });

  it("hostile -> indifferent mid-combat on its own turn: neutral, leaves the order, the turn passes on", () => {
    const r = adjust(fight(1), "m1", 1, "offered terms");
    expect(m(r.state, "m1")).toMatchObject({ attitude: "indifferent", attitudeScore: -2, ally: false, neutral: true });
    expect(r.state.combat.order.map((o) => o.entityId)).toEqual(["pc_a", "m2"]);
    expect(r.state.combat.order[r.state.combat.turnIndex].entityId).toBe("m2");
    expect(attitudeMoments(r)).toEqual([expect.objectContaining({ targetId: "m1", outcome: "indifferent" })]);
  });

  it("hostile -> indifferent mid-combat, not its turn: the current creature keeps its turn", () => {
    const r = adjust(fight(2), "m1", 2, "offered terms");
    expect(r.state.combat.order.map((o) => o.entityId)).toEqual(["pc_a", "m2"]);
    expect(r.state.combat.order[r.state.combat.turnIndex].entityId).toBe("m2");
  });
});

describe("adjust_attitude: clamping", () => {
  it("+4 then +4 -> 5", () => {
    let s = adjust(base(), "m3", 4, "gift").state;
    expect(m(s, "m3")!.attitudeScore).toBe(4);
    const r = adjust(s, "m3", 4, "another gift");
    s = r.state;
    expect(m(s, "m3")).toMatchObject({ attitudeScore: 5, attitude: "friendly" });
    expect(r.outcome.output).toMatchObject({ score: 5, changed: false });
  });

  it("-3 (derived foe) -5 -> -5", () => {
    const r = adjust(base(), "m1", -5, "spat at");
    expect(m(r.state, "m1")).toMatchObject({ attitudeScore: -5, attitude: "hostile", ally: false, neutral: false });
    expect(attitudeMoments(r)).toEqual([]);
  });
});

describe("set_disposition syncs the attitude", () => {
  it("foe -> hostile, score min(current, -3)", () => {
    let s = base();
    m(s, "m3")!.attitudeScore = 1;
    s = run(s, "set_disposition", { monster_id: "m3", disposition: "foe" }).state;
    expect(m(s, "m3")).toMatchObject({ attitude: "hostile", attitudeScore: -3 });
    const s2 = base();
    m(s2, "m1")!.attitudeScore = -5;
    m(s2, "m1")!.attitude = "hostile";
    expect(m(run(s2, "set_disposition", { monster_id: "m1", disposition: "foe" }).state, "m1")).toMatchObject({ attitude: "hostile", attitudeScore: -5 });
  });

  it("neutral -> indifferent, stored score clamped into -2..2; 0 when derived", () => {
    const s = base();
    m(s, "m4")!.attitudeScore = 4;
    expect(m(run(s, "set_disposition", { monster_id: "m4", disposition: "neutral" }).state, "m4")).toMatchObject({ attitude: "indifferent", attitudeScore: 2 });
    const s2 = base();
    m(s2, "m1")!.attitudeScore = -4;
    expect(m(run(s2, "set_disposition", { monster_id: "m1", disposition: "neutral" }).state, "m1")).toMatchObject({ attitude: "indifferent", attitudeScore: -2 });
    // A foe from an old save (no stored score) made neutral starts at 0.
    expect(m(run(base(), "set_disposition", { monster_id: "m2", disposition: "neutral" }).state, "m2")).toMatchObject({ attitude: "indifferent", attitudeScore: 0 });
  });

  it("ally -> friendly, score max(current, 3)", () => {
    expect(m(run(base(), "set_disposition", { monster_id: "m1", disposition: "ally" }).state, "m1")).toMatchObject({ attitude: "friendly", attitudeScore: 3 });
    const s = base();
    m(s, "m4")!.attitudeScore = 5;
    expect(m(run(s, "set_disposition", { monster_id: "m4", disposition: "ally" }).state, "m4")).toMatchObject({ attitude: "friendly", attitudeScore: 5 });
  });
});

describe("get_party_status lists attitudes", () => {
  it("every monster/NPC carries attitude and attitude_score (derived for old saves)", () => {
    const s = base();
    m(s, "m2")!.attitudeScore = -1;
    const out = run(s, "get_party_status", {}).outcome.output as { monsters: Record<string, unknown>[] };
    const by = (id: string) => out.monsters.find((x) => x.id === id)!;
    expect(by("m1")).toMatchObject({ attitude: "hostile", attitude_score: -3 });
    expect(by("m2")).toMatchObject({ attitude: "indifferent", attitude_score: -1 });
    expect(by("m3")).toMatchObject({ attitude: "indifferent", attitude_score: 0 });
    expect(by("m4")).toMatchObject({ attitude: "friendly", attitude_score: 3 });
  });
});

describe("adjust_attitude: a downed NPC drifting into Hostile stays down (review fix)", () => {
  it("an Unconscious NPC at 0 HP becomes hostile but is not killed", () => {
    const s = base();
    const pell = s.monsters.find((x) => x.id === "m4")!;
    pell.hp = 0;
    pell.conditions = ["Unconscious"];
    let r = adjust(s, "m4", -2, "an insult");
    r = adjust(r.state, "m4", -2, "another insult");
    r = adjust(r.state, "m4", -2, "a threat");
    expect(m(r.state, "m4")).toMatchObject({ attitude: "hostile", attitudeScore: -3, ally: false, neutral: false });
    expect(m(r.state, "m4")!.conditions).toContain("Unconscious");
    expect(m(r.state, "m4")!.conditions).not.toContain("Dead");
    expect(r.outcome.moments.some((x) => x.kind === "death")).toBe(false);
  });

  it("set_disposition foe (the hard flip) still applies the foe rule: 0 HP is dead", () => {
    const s = base();
    const pell = s.monsters.find((x) => x.id === "m4")!;
    pell.hp = 0;
    pell.conditions = ["Unconscious"];
    const r = run(s, "set_disposition", { monster_id: "m4", disposition: "foe" });
    expect(m(r.state, "m4")!.conditions).toContain("Dead");
  });
});
