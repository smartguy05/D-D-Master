import { describe, expect, it } from "vitest";
import { Character, emptyGameState, Monster, type GameState, type Moment, type Rng } from "@dm/shared";
import { ENGINE_TOOLS, executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";
import { deathRuleEnds, newlyDeadPcs, partyDead } from "./moments.js";
import { foesOf, stalledTurn } from "./turns.js";

/**
 * Moments (victory, defeat, death, revived, turn_start…): transient table events collected in
 * EngineOutcome.moments, never written into the GameState. Death/revived for PCs: rules/vitals.test.ts.
 */

const seq =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

function ctx(rng: Rng = seq(10)): EngineContext {
  return { rng, monsterTemplate: () => undefined, spell: () => undefined, spellCandidates: () => [], classData: () => undefined, locations: [] };
}

const run = (s: GameState, name: EngineTool, args: unknown, rng?: Rng) => executeEngineTool(s, name, args, ctx(rng));
const momentsOf = (r: { outcome: unknown }): Moment[] => (r.outcome as { moments: Moment[] }).moments;
const kinds = (r: { outcome: unknown }) => momentsOf(r).map((m) => m.kind);

const pc = (id: string, name: string, over: Record<string, unknown> = {}) => Character.parse({ id, playerName: name, name, maxHp: 12, hp: 12, ...over });
const mon = (id: string, name: string, over: Record<string, unknown> = {}) => Monster.parse({ id, name, maxHp: 7, hp: 7, ac: 13, ...over });

/** A fight already under way: initiative in the given order, the first creature's turn. */
function fight(chars: Character[], monsters: Monster[], over: Partial<GameState["combat"]> = {}): GameState {
  const s = emptyGameState("c1");
  s.characters.push(...chars);
  s.monsters.push(...monsters);
  const order = [
    ...chars.map((c, i) => ({ entityId: c.id, entityType: "character" as const, name: c.name, initiative: 20 - i })),
    ...monsters.filter((m) => m.combatant !== false && !m.neutral).map((m, i) => ({ entityId: m.id, entityType: "monster" as const, name: m.name, initiative: 10 - i })),
  ];
  s.combat = { active: true, round: 1, turnIndex: 0, order, turn: null, reactionsUsed: [], announced: [], ...over } as GameState["combat"];
  return s;
}

describe("moment helper and EngineOutcome.moments", () => {
  it("moment() builds a moment with a unique id and a numeric ts", async () => {
    // Imported here so the rest of this file still runs (and fails one by one) before the module exists.
    const { moment } = (await import("./moments.js")) as { moment: (kind: Moment["kind"], o?: Partial<Pick<Moment, "targetId" | "outcome" | "text">>) => Moment };
    const a = moment("death", { targetId: "m1", outcome: "monster" });
    const b = moment("victory");
    expect(a).toMatchObject({ kind: "death", targetId: "m1", outcome: "monster" });
    expect(typeof a.id).toBe("string");
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id);
    expect(typeof a.ts).toBe("number");
    expect(b).toMatchObject({ kind: "victory" });
    expect(b.targetId).toBeUndefined();
    expect(moment("campaign_end", { outcome: "success", text: "The end." })).toMatchObject({ outcome: "success", text: "The end." });
  });

  it("every engine tool returns a moments array ([] when nothing happened)", () => {
    const r = run(fight([pc("pc_a", "Mara")], []), "give_item", { character_id: "pc_a", name: "Torch" });
    expect(momentsOf(r)).toEqual([]);
  });

  it("moments are never written into the GameState", () => {
    const r = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]), "apply_damage", { target_id: "m1", amount: 20 });
    expect(momentsOf(r).length).toBeGreaterThan(0);
    const json = JSON.stringify(r.state);
    for (const m of momentsOf(r)) expect(json).not.toContain(m.id);
    expect(r.state).not.toHaveProperty("moments");
  });

  it("end_campaign is a service tool, not an engine tool", () => {
    expect(ENGINE_TOOLS as readonly string[]).not.toContain("end_campaign");
  });
});

describe("turn_start", () => {
  it("start_combat pushes one turn_start for the first creature in the order", () => {
    const s = emptyGameState("c1");
    s.characters.push(pc("pc_a", "Mara"));
    s.monsters.push(mon("m1", "Goblin"));
    const r = run(s, "start_combat", {}, seq(20, 1));
    const turns = momentsOf(r).filter((m) => m.kind === "turn_start");
    expect(turns).toHaveLength(1);
    expect(turns[0].targetId).toBe(r.state.combat.order[0].entityId);
  });

  it("start_combat with nobody in the order pushes no turn_start", () => {
    const r = run(emptyGameState("c1"), "start_combat", {});
    expect(r.state.combat.order).toHaveLength(0);
    expect(kinds(r)).not.toContain("turn_start");
  });

  it("next_turn pushes one turn_start for the creature now current, skipping the dead", () => {
    const s = fight([pc("pc_a", "Mara"), pc("pc_b", "Thorin")], [mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] }), mon("m2", "Orc", { maxHp: 15, hp: 15 })]);
    // order: Mara, Thorin, Goblin (dead), Orc
    s.combat.turnIndex = 1;
    const r = run(s, "next_turn", {});
    expect(r.state.combat.order[r.state.combat.turnIndex].entityId).toBe("m2");
    expect(momentsOf(r).filter((m) => m.kind === "turn_start")).toEqual([expect.objectContaining({ kind: "turn_start", targetId: "m2" })]);
  });

  it("next_turn wrapping to a new round announces the first creature", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]);
    s.combat.turnIndex = 1;
    const r = run(s, "next_turn", {});
    expect(r.state.combat.round).toBe(2);
    expect(momentsOf(r).filter((m) => m.kind === "turn_start")).toEqual([expect.objectContaining({ targetId: "pc_a" })]);
  });

  it("removing the current creature from initiative starts (and announces) the next one's turn", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin"), mon("m2", "Orc")]);
    s.combat.turnIndex = 1; // the goblin's turn
    const r = run(s, "remove_monster", { monster_id: "m1" });
    expect(momentsOf(r).filter((m) => m.kind === "turn_start")).toEqual([expect.objectContaining({ targetId: "m2" })]);
  });

  it("set_disposition taking the current creature out of the fight announces the next turn", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin"), mon("m2", "Orc")]);
    s.combat.turnIndex = 1;
    const r = run(s, "set_disposition", { monster_id: "m1", disposition: "neutral" });
    expect(momentsOf(r).filter((m) => m.kind === "turn_start")).toEqual([expect.objectContaining({ targetId: "m2" })]);
  });

  it("other tools on a turn push no turn_start", () => {
    const r = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]), "apply_damage", { target_id: "m1", amount: 1 });
    expect(kinds(r)).not.toContain("turn_start");
  });
});

describe("monster deaths", () => {
  it("a foe taken from >0 to 0 HP pushes death with outcome monster", () => {
    const r = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin"), mon("m2", "Orc")]), "apply_damage", { target_id: "m1", amount: 9 });
    expect(momentsOf(r)).toEqual([expect.objectContaining({ kind: "death", targetId: "m1", outcome: "monster" })]);
  });

  it("works out of combat too", () => {
    const s = emptyGameState("c1");
    s.monsters.push(mon("m1", "Goblin"));
    expect(momentsOf(run(s, "apply_damage", { target_id: "m1", amount: 9 }))).toEqual([expect.objectContaining({ kind: "death", targetId: "m1", outcome: "monster" })]);
  });

  it("damaging an already-dead monster pushes nothing", () => {
    const s = emptyGameState("c1");
    s.monsters.push(mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] }));
    expect(momentsOf(run(s, "apply_damage", { target_id: "m1", amount: 3 }))).toEqual([]);
  });

  it("an ally knocked out (Unconscious) pushes no death", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m_ally", "Pell", { ally: true }), mon("m2", "Orc")]);
    const r = run(s, "apply_damage", { target_id: "m_ally", amount: 20 });
    expect(r.state.monsters[0].conditions).toContain("Unconscious");
    expect(kinds(r)).not.toContain("death");
  });

  it("a PC dropping to 0 without dying pushes no death", () => {
    const r = run(fight([pc("pc_a", "Mara"), pc("pc_b", "Thorin")], [mon("m1", "Goblin")]), "apply_damage", { target_id: "pc_a", amount: 13 });
    expect(r.state.characters[0].conditions).toContain("Unconscious");
    expect(kinds(r)).not.toContain("death");
  });
});

describe("foesOf", () => {
  it("is the monsters that are neither allies nor neutral", () => {
    const s = emptyGameState("c1");
    s.monsters.push(mon("m1", "Goblin"), mon("m_ally", "Pell", { ally: true }), mon("m_n", "Cat", { neutral: true }), mon("m_dead", "Rat", { hp: 0, conditions: ["Dead"] }));
    expect(foesOf(s).map((m) => m.id)).toEqual(["m1", "m_dead"]);
  });

  it("stalledTurn keeps its end-of-fight nudge with the shared helper", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] }), mon("m_n", "Cat", { neutral: true })]);
    expect(stalledTurn(s)?.prompt).toMatch(/end_combat/);
  });
});

describe("auto victory", () => {
  it("killing the last foe pushes death then victory, records it and hints the DM to call end_combat", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]);
    const r = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect(kinds(r)).toEqual(["death", "victory"]);
    expect(momentsOf(r)[1].targetId).toBeUndefined();
    expect(r.state.combat.announced).toEqual(["victory"]);
    const out = r.outcome.output as { victory_hint?: unknown };
    expect(typeof out.victory_hint).toBe("string");
    expect(out.victory_hint).toContain("end_combat");
    expect(r.state.combat.active).toBe(true); // the DM ends it
  });

  it("is announced once per combat: hitting the corpse again pushes nothing", () => {
    const first = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]), "apply_damage", { target_id: "m1", amount: 9 });
    const second = run(first.state, "apply_damage", { target_id: "m1", amount: 3 });
    expect(momentsOf(second)).toEqual([]);
    expect((second.outcome.output as { victory_hint?: unknown }).victory_hint).toBeUndefined();
    expect(second.state.combat.announced).toEqual(["victory"]);
  });

  it("waits for every foe; allies and neutral creatures don't count", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin"), mon("m2", "Orc"), mon("m_ally", "Pell", { ally: true }), mon("m_n", "Cat", { neutral: true })]);
    const one = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect(kinds(one)).toEqual(["death"]);
    const two = run(one.state, "apply_damage", { target_id: "m2", amount: 9 });
    expect(kinds(two)).toEqual(["death", "victory"]);
  });

  it("a fight with no foes never pushes victory", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m_ally", "Pell", { ally: true })]);
    const r = run(s, "apply_damage", { target_id: "m_ally", amount: 20 });
    expect(kinds(r)).not.toContain("victory");
    expect(run(fight([pc("pc_a", "Mara")], []), "next_turn", {}).outcome).toMatchObject({ moments: [expect.objectContaining({ kind: "turn_start" })] });
    expect(kinds(run(fight([pc("pc_a", "Mara")], []), "next_turn", {}))).not.toContain("victory");
  });

  it("out of combat nothing is announced", () => {
    const s = emptyGameState("c1");
    s.characters.push(pc("pc_a", "Mara"));
    s.monsters.push(mon("m1", "Goblin"));
    const r = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect(kinds(r)).toEqual(["death"]);
    expect((r.outcome.output as { victory_hint?: unknown }).victory_hint).toBeUndefined();
  });

  it("start_combat with every foe already dead pushes no victory", () => {
    const s = emptyGameState("c1");
    s.characters.push(pc("pc_a", "Mara"));
    s.monsters.push(mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] }));
    expect(kinds(run(s, "start_combat", {}))).not.toContain("victory");
  });

  it("does not mutate the input state (announced lives only in the clone)", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]);
    const before = structuredClone(s);
    const r = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect(r.state.combat.announced).toEqual(["victory"]);
    expect(s).toEqual(before);
    expect(s.combat.announced).toEqual([]);
  });
});

describe("old corpses and out-of-combat end_combat (bug: false-victory-from-corpses)", () => {
  it("end_combat out of combat pushes no moment, logs nothing and changes nothing", () => {
    const won = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]), "apply_damage", { target_id: "m1", amount: 9 });
    const over = run(won.state, "end_combat", {});
    expect(over.state.combat.active).toBe(false);
    const again = run(over.state, "end_combat", {});
    expect(momentsOf(again)).toEqual([]);
    expect((again.outcome.output as { outcome?: unknown }).outcome).toBeUndefined();
    expect(again.state.log.length).toBe(over.state.log.length);
    const explicit = run(over.state, "end_combat", { outcome: "victory" });
    expect(momentsOf(explicit)).toEqual([]);
  });

  it("a new combat with only old corpses announces no victory until a new foe falls", () => {
    const s = emptyGameState("c1");
    s.characters.push(pc("pc_a", "Mara"));
    s.monsters.push(mon("m_old", "Goblin", { hp: 0, conditions: ["Dead"] }));
    const started = run(s, "start_combat", {}, seq(20, 1));
    const r = run(started.state, "roll_dice", { notation: "1d20", label: "Perception" });
    expect(kinds(r)).not.toContain("victory");
    expect((r.outcome.output as { victory_hint?: unknown }).victory_hint).toBeUndefined();
    expect(stalledTurn(r.state)?.prompt ?? "").not.toMatch(/no foe is left/);
  });

  it("old corpses don't count, the new fight's foes do; a living reinforcement still holds victory back", () => {
    const s = emptyGameState("c1");
    s.characters.push(pc("pc_a", "Mara"));
    s.monsters.push(mon("m_old", "Goblin", { hp: 0, conditions: ["Dead"] }), mon("m1", "Orc"));
    const started = run(s, "start_combat", {}, seq(20, 1));
    started.state.monsters.push(mon("m_late", "Wolf")); // spawned mid-fight: not in the initiative order
    const one = run(started.state, "apply_damage", { target_id: "m1", amount: 9 });
    expect(kinds(one)).not.toContain("victory");
    const two = run(one.state, "apply_damage", { target_id: "m_late", amount: 9 });
    expect(kinds(two)).toContain("victory");
  });
});

describe("victory while a PC is dying (bug: victory-hint-while-dying)", () => {
  it("the victory banner plays but the hint says to stabilise the dying first, not to end_combat", () => {
    const s = fight([pc("pc_a", "Mara", { hp: 0, conditions: ["Unconscious"], deathSaves: { successes: 0, failures: 1, stable: false } }), pc("pc_b", "Bob")], [mon("m1", "Goblin")]);
    const r = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect(kinds(r)).toContain("victory");
    const hint = String((r.outcome.output as { victory_hint?: unknown }).victory_hint);
    expect(hint).toMatch(/Mara/);
    expect(hint).toMatch(/dying/i);
    expect(hint).not.toMatch(/then call end_combat/);
  });

  it("a stable or dead PC does not hold the hint back", () => {
    const s = fight([pc("pc_a", "Mara", { hp: 0, conditions: ["Unconscious"], deathSaves: { successes: 0, failures: 0, stable: true } }), pc("pc_b", "Bob")], [mon("m1", "Goblin")]);
    const r = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect(String((r.outcome.output as { victory_hint?: unknown }).victory_hint)).toMatch(/then call end_combat/);
  });
});

describe("auto defeat", () => {
  it("pushes defeat once when every PC is at 0 HP", () => {
    const s = fight([pc("pc_a", "Mara"), pc("pc_b", "Thorin")], [mon("m1", "Goblin")]);
    const one = run(s, "apply_damage", { target_id: "pc_a", amount: 13 });
    expect(kinds(one)).not.toContain("defeat"); // Thorin still stands
    const two = run(one.state, "apply_damage", { target_id: "pc_b", amount: 13 });
    expect(kinds(two)).toContain("defeat");
    expect(momentsOf(two).filter((m) => m.kind === "defeat")).toHaveLength(1);
    expect(two.state.combat.announced).toContain("defeat");
    const three = run(two.state, "apply_damage", { target_id: "pc_b", amount: 1 });
    expect(kinds(three)).not.toContain("defeat");
  });

  it("counts Stable and Dead PCs as down", () => {
    const s = fight(
      [pc("pc_a", "Mara", { hp: 0, conditions: ["Dead"], deathSaves: { successes: 0, failures: 3, stable: false } }), pc("pc_b", "Thorin", { hp: 0, conditions: ["Unconscious"], deathSaves: { successes: 0, failures: 0, stable: true } }), pc("pc_c", "Pip", { hp: 3 })],
      [mon("m1", "Goblin")],
    );
    expect(kinds(run(s, "apply_damage", { target_id: "pc_c", amount: 5 }))).toContain("defeat");
  });

  it("no characters means no defeat", () => {
    const s = fight([], [mon("m1", "Goblin"), mon("m2", "Orc")]);
    expect(kinds(run(s, "apply_damage", { target_id: "m1", amount: 1 }))).toEqual([]);
  });
});

describe("death rule", () => {
  const dead = (id: string, name: string) => pc(id, name, { hp: 0, conditions: ["Dead"], deathSaves: { successes: 0, failures: 3, stable: false } });
  const stable = (id: string, name: string) => pc(id, name, { hp: 0, conditions: ["Unconscious"], deathSaves: { successes: 3, failures: 0, stable: true } });
  const party = (...chars: Character[]) => {
    const s = emptyGameState("c1");
    s.characters.push(...chars);
    return s;
  };

  it("partyDead: every PC has the Dead condition; unconscious or stable PCs don't count; false with no PCs", () => {
    expect(partyDead(party(dead("a", "Mara"), dead("b", "Thorin")))).toBe(true);
    expect(partyDead(party(dead("a", "Mara"), stable("b", "Thorin")))).toBe(false);
    expect(partyDead(party(dead("a", "Mara"), pc("b", "Thorin")))).toBe(false);
    expect(partyDead(party())).toBe(false);
  });

  it("newlyDeadPcs lists PCs dead after but not before", () => {
    expect(newlyDeadPcs(party(pc("a", "Mara"), pc("b", "Thorin")), party(dead("a", "Mara"), pc("b", "Thorin")))).toEqual(["a"]);
    expect(newlyDeadPcs(party(dead("a", "Mara"), pc("b", "Thorin")), party(dead("a", "Mara"), pc("b", "Thorin")))).toEqual([]);
  });

  it("party_wipe ends only on the last death", () => {
    const start = party(pc("a", "Mara"), pc("b", "Thorin"));
    const one = party(dead("a", "Mara"), pc("b", "Thorin"));
    const both = party(dead("a", "Mara"), dead("b", "Thorin"));
    expect(deathRuleEnds("party_wipe", start, one)).toBe(false);
    expect(deathRuleEnds("party_wipe", one, both)).toBe(true);
    expect(deathRuleEnds("party_wipe", both, both)).toBe(false); // already wiped: no re-trigger
    expect(deathRuleEnds("party_wipe", one, party(dead("a", "Mara"), stable("b", "Thorin")))).toBe(false);
  });

  it("any_death ends on the first new death, not on a PC who was already dead", () => {
    const start = party(pc("a", "Mara"), pc("b", "Thorin"));
    const one = party(dead("a", "Mara"), pc("b", "Thorin"));
    expect(deathRuleEnds("any_death", start, one)).toBe(true);
    expect(deathRuleEnds("any_death", one, one)).toBe(false);
    expect(deathRuleEnds("any_death", start, party(stable("a", "Mara"), pc("b", "Thorin")))).toBe(false);
    expect(deathRuleEnds("any_death", party(), party())).toBe(false);
  });
});

describe("end_combat outcome", () => {
  const ended = (r: ReturnType<typeof run>) => {
    expect(r.state.combat.active).toBe(false);
    expect(r.state.combat.order).toEqual([]);
  };
  const lastLog = (s: GameState) => s.log[s.log.length - 1]?.text;

  it("an explicit outcome pushes that moment, names it in the output and the log", () => {
    for (const outcome of ["victory", "fled", "defeat"] as const) {
      // A DM victory needs the foes down (victory-with-foe-standing).
      const goblin = mon("m1", "Goblin", outcome === "victory" ? { hp: 0, conditions: ["Dead"] } : {});
      const r = run(fight([pc("pc_a", "Mara")], [goblin]), "end_combat", { outcome });
      ended(r);
      expect(kinds(r)).toEqual([outcome]);
      expect(r.outcome.output).toMatchObject({ outcome });
      expect(lastLog(r.state)).toBe(`Combat ends (${outcome}).`);
    }
  });

  it("an explicit victory already announced is not shown twice", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] })], { announced: ["victory"] } as Partial<GameState["combat"]>);
    const r = run(s, "end_combat", { outcome: "victory" });
    ended(r);
    expect(momentsOf(r)).toEqual([]);
    expect(r.outcome.output).toMatchObject({ outcome: "victory" });
  });

  it("an explicit defeat already announced is not shown twice", () => {
    const s = fight([pc("pc_a", "Mara", { hp: 0, conditions: ["Unconscious"] })], [mon("m1", "Goblin")], { announced: ["defeat"] } as Partial<GameState["combat"]>);
    expect(momentsOf(run(s, "end_combat", { outcome: "defeat" }))).toEqual([]);
  });

  it("without an outcome: victory when foes existed and none is left", () => {
    const r = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] })]), "end_combat", {});
    ended(r);
    expect(kinds(r)).toEqual(["victory"]);
    expect(r.outcome.output).toMatchObject({ outcome: "victory" });
    expect(lastLog(r.state)).toBe("Combat ends (victory).");
  });

  it("without an outcome: an already-announced victory is not repeated", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] })], { announced: ["victory"] } as Partial<GameState["combat"]>);
    const r = run(s, "end_combat", {});
    ended(r);
    expect(momentsOf(r)).toEqual([]);
  });

  it("without an outcome: defeat when every PC is down", () => {
    const r = run(fight([pc("pc_a", "Mara", { hp: 0, conditions: ["Unconscious"] })], [mon("m1", "Goblin")]), "end_combat", {});
    ended(r);
    expect(kinds(r)).toEqual(["defeat"]);
    expect(r.outcome.output).toMatchObject({ outcome: "defeat" });
  });

  it("without an outcome and nothing decided: no moment, combat still ends", () => {
    const r = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin")]), "end_combat", {});
    ended(r);
    expect(momentsOf(r)).toEqual([]);
    const noFoes = run(fight([pc("pc_a", "Mara")], []), "end_combat", {});
    ended(noFoes);
    expect(momentsOf(noFoes)).toEqual([]);
  });

  it("a fresh combat starts with nothing announced", () => {
    const r = run(fight([pc("pc_a", "Mara")], [mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] })], { announced: ["victory"] } as Partial<GameState["combat"]>), "end_combat", {});
    expect(r.state.combat.announced).toEqual([]);
    const s = r.state;
    s.monsters.push(mon("m2", "Orc"));
    expect(run(s, "start_combat", {}, seq(20, 1)).state.combat.announced).toEqual([]);
  });

  it("change_scene leaves a combat with nothing announced", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Goblin", { hp: 0, conditions: ["Dead"] })], { announced: ["victory"] } as Partial<GameState["combat"]>);
    const c = { ...ctx(), locations: [{ id: "loc_b", name: "Hall", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 10, gridH: 8 }] } as EngineContext;
    expect(executeEngineTool(s, "change_scene", { location_id: "loc_b" }, c).state.combat.announced).toEqual([]);
  });
});

describe("end_combat victory with a foe still standing (bug: victory-with-foe-standing)", () => {
  it("the DM's victory is refused and names the foe; combat goes on with no banner", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Shrub 1"), mon("m2", "Shrub 2", { hp: 6 })]);
    const one = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    const r = run(one.state, "end_combat", { outcome: "victory" });
    expect(String((r.outcome.output as { error?: unknown }).error)).toMatch(/Shrub 2.*6\/7/);
    expect(r.state.combat.active).toBe(true);
    expect(momentsOf(r)).toEqual([]);
  });

  it("the host can still force it, and no outcome or fled still ends the fight", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Shrub 1")]);
    const host = executeEngineTool(s, "end_combat", { outcome: "victory" }, { ...ctx(), source: "host" });
    expect(host.state.combat.active).toBe(false);
    expect(kinds(host)).toContain("victory");
    expect(run(s, "end_combat", {}).state.combat.active).toBe(false);
    expect(run(s, "end_combat", { outcome: "fled" }).state.combat.active).toBe(false);
  });

  it("a killing blow tells the DM which foes are still standing", () => {
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Shrub 1"), mon("m2", "Shrub 2")]);
    const one = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect((one.outcome.output as { foes_standing?: unknown }).foes_standing).toEqual(["Shrub 2 (m2, 7/7 HP)"]);
    const two = run(one.state, "apply_damage", { target_id: "m2", amount: 9 });
    expect((two.outcome.output as { foes_standing?: unknown }).foes_standing).toBeUndefined();
  });

  it("a hostile NPC sitting the fight out (combatant false) is not a foe standing (bug: non-combatant-blocks-victory)", () => {
    const npc = mon("n1", "Elian", { npc: true, combatant: false, attitude: "hostile" });
    const s = fight([pc("pc_a", "Mara")], [mon("m1", "Shrub 1"), npc]);
    const one = run(s, "apply_damage", { target_id: "m1", amount: 9 });
    expect((one.outcome.output as { foes_standing?: unknown }).foes_standing).toBeUndefined();
    expect(kinds(one)).toContain("victory");
    const r = run(one.state, "end_combat", { outcome: "victory" });
    expect(r.state.combat.active).toBe(false);
    // Nobody had to turn it neutral: it stays on the TV's list as it was.
    expect(r.state.monsters.find((m) => m.id === "n1")).toMatchObject({ neutral: false, ally: false, hp: 7 });
  });
});

describe("combat_start (feature: battle intro)", () => {
  it("start_combat pushes combat_start before the first turn_start", () => {
    const s = emptyGameState("c1");
    s.characters.push(pc("pc_a", "Mara"));
    s.monsters.push(mon("m1", "Goblin"));
    expect(kinds(run(s, "start_combat", {}, seq(20, 1)))).toEqual(["combat_start", "turn_start"]);
  });

  it("tells the DM to announce the battle and the order first, even when a monster acts first", () => {
    const s = emptyGameState("c1");
    s.characters.push(pc("pc_a", "Mara"));
    s.monsters.push(mon("m1", "Goblin"));
    const r = run(s, "start_combat", {}, seq(1, 20)); // the goblin wins initiative
    expect(r.state.combat.order[0].entityId).toBe("m1");
    const out = r.outcome.output as { announce?: string; instruction?: string };
    expect(out.announce).toMatch(/battle/i);
    expect(out.announce).toMatch(/Goblin.*Mara/);
    expect(out.instruction).toMatch(/after announcing/i);
  });

  it("an empty order pushes no combat_start", () => {
    expect(kinds(run(emptyGameState("c1"), "start_combat", {}))).not.toContain("combat_start");
  });
});
