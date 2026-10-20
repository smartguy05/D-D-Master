import { describe, expect, it } from "vitest";
import { Character, emptyGameState, Monster, type GameState, type Rng } from "@dm/shared";
import { executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";

/**
 * Friendly and neutral creatures (bugs ally-npc-dies-in-one-hit, TODO "Friendly creatures"):
 * allies drop Unconscious at 0 HP instead of dying, initiative is opt-in for NPCs (Monster.combatant),
 * neutral creatures stay out of combat, and set_disposition switches a creature's side.
 */

const seq =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

function ctx(rng: Rng = seq(10)): EngineContext {
  return {
    rng,
    monsterTemplate: (name) =>
      name.toLowerCase() === "commoner"
        ? { name: "Commoner", srdName: "Commoner", maxHp: 4, ac: 10, initiativeBonus: 0, speed: 30, attacksPerAction: 1, attacks: [], conditions: [], hidden: false, npc: false, appearance: "", ally: false, follows: false, combatant: true, neutral: false, conditionMeta: [] }
        : name.toLowerCase() === "kobold warrior"
          ? { name: "Kobold Warrior", srdName: "Kobold Warrior", maxHp: 7, ac: 14, initiativeBonus: 2, speed: 30, attacksPerAction: 1, attacks: [], conditions: [], hidden: false, npc: false, appearance: "", ally: false, follows: false, combatant: true, neutral: false, conditionMeta: [] }
          : undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [
      { id: "loc_shore", name: "Shore", description: "", mapPrompt: "", fog: false, features: [], gridW: 12, gridH: 8 },
      { id: "loc_tower", name: "Lighthouse", description: "", mapPrompt: "", fog: false, features: [], gridW: 12, gridH: 8 },
    ],
  };
}

const run = (s: GameState, tool: string, args: unknown, rng?: Rng) => executeEngineTool(s, tool as EngineTool, args, ctx(rng));
type Out = Record<string, unknown> & { error?: string };

/** A refused call: thrown, or returned as { error }. */
function refusal(fn: () => ReturnType<typeof run>): string {
  try {
    return String((fn().outcome.output as Out | null)?.error ?? "");
  } catch (e) {
    return (e as Error).message;
  }
}

const mon = (over: Record<string, unknown> & { id: string; name: string }) => Monster.parse({ maxHp: 7, hp: 7, ac: 12, ...over });
const party = () => {
  const s = emptyGameState("c1");
  s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Bram", maxHp: 12, hp: 12 }));
  return s;
};
const m = (s: GameState, id: string) => s.monsters.find((x) => x.id === id);
const field = (x: unknown, k: string) => (x as Record<string, unknown> | undefined)?.[k];

describe("Monster schema: combatant and neutral", () => {
  it("defaults combatant true and neutral false", () => {
    const g = mon({ id: "m1", name: "Goblin" });
    expect(field(g, "combatant")).toBe(true);
    expect(field(g, "neutral")).toBe(false);
  });
});

describe("allies at 0 HP", () => {
  it("an ally dropped to 0 HP is Unconscious, not Dead, and stays on the map", () => {
    const s = party();
    s.monsters.push(mon({ id: "m_pell", name: "Pell Netter", npc: true, ally: true, maxHp: 4, hp: 4 }));
    const r = run(s, "apply_damage", { target_id: "m_pell", amount: 9 });
    expect(m(r.state, "m_pell")).toBeDefined();
    expect(m(r.state, "m_pell")!.hp).toBe(0);
    expect(m(r.state, "m_pell")!.conditions).toContain("Unconscious");
    expect(m(r.state, "m_pell")!.conditions).not.toContain("Dead");
    const healed = run(r.state, "heal", { target_id: "m_pell", amount: 2 }).state;
    expect(m(healed, "m_pell")!.hp).toBe(2);
    expect(m(healed, "m_pell")!.conditions).not.toContain("Unconscious");
  });

  it("a foe still dies at 0 HP", () => {
    const s = party();
    s.monsters.push(mon({ id: "m1", name: "Skeleton" }));
    expect(m(run(s, "apply_damage", { target_id: "m1", amount: 20 }).state, "m1")!.conditions).toEqual(["Dead"]);
  });

  it("change_scene keeps a following ally at 0 HP", () => {
    let s = run(party(), "change_scene", { location_id: "loc_shore" }).state;
    s.monsters.push(mon({ id: "m_pell", name: "Pell Netter", npc: true, ally: true, follows: true, maxHp: 4, hp: 4 }));
    s = run(s, "apply_damage", { target_id: "m_pell", amount: 4 }).state;
    s = run(s, "change_scene", { location_id: "loc_tower" }).state;
    expect(m(s, "m_pell")).toBeDefined();
    expect(s.tokens.some((t) => t.entityId === "m_pell")).toBe(true);
  });
});

describe("opt-in initiative", () => {
  it("add_npc creates a non-combatant by default; combatant: true opts in", () => {
    let s = run(party(), "change_scene", { location_id: "loc_shore" }).state;
    s = run(s, "add_npc", { name: "Pell Netter" }).state;
    expect(field(s.monsters[0], "combatant")).toBe(false);
    s = run(s, "add_npc", { name: "Captain Venn", combatant: true }).state;
    expect(field(s.monsters.find((x) => x.name === "Captain Venn"), "combatant")).toBe(true);
  });

  it("spawn_monster monsters are combatants", () => {
    const s = run(run(party(), "change_scene", { location_id: "loc_shore" }).state, "spawn_monster", { name: "Kobold Warrior", count: 2 }).state;
    expect(s.monsters.map((x) => field(x, "combatant"))).toEqual([true, true]);
  });

  it("start_combat includes foes and combatant allies, skips non-combatants and neutrals", () => {
    const s = party();
    s.monsters.push(
      mon({ id: "m_foe", name: "Skeleton" }),
      mon({ id: "m_ally", name: "Captain Venn", npc: true, ally: true, combatant: true }),
      mon({ id: "m_npc", name: "Pell Netter", npc: true, ally: true, combatant: false }),
      mon({ id: "m_neutral", name: "Tikk", neutral: true }),
    );
    const ids = run(s, "start_combat", {}).state.combat.order.map((o) => o.entityId);
    expect(ids).toEqual(expect.arrayContaining(["pc_a", "m_foe", "m_ally"]));
    expect(ids).not.toContain("m_npc");
    expect(ids).not.toContain("m_neutral");
  });

  it("an NPC from add_npc stays out of start_combat", () => {
    let s = run(party(), "change_scene", { location_id: "loc_shore" }).state;
    s = run(s, "add_npc", { name: "Pell Netter" }).state;
    const id = s.monsters[0].id;
    expect(run(s, "start_combat", {}).state.combat.order.map((o) => o.entityId)).not.toContain(id);
  });
});

describe("set_disposition", () => {
  const base = () => {
    const s = party();
    s.monsters.push(mon({ id: "m1", name: "Kobold 1" }), mon({ id: "m2", name: "Kobold 2" }), mon({ id: "m3", name: "Tikk", npc: true, combatant: false }));
    return s;
  };

  it("foe / ally / neutral set the ally and neutral flags and the output names the creature", () => {
    let r = run(base(), "set_disposition", { monster_id: "m1", disposition: "ally" });
    expect(m(r.state, "m1")).toMatchObject({ ally: true, neutral: false });
    expect(JSON.stringify(r.outcome.output)).toMatch(/Kobold 1/);
    expect(JSON.stringify(r.outcome.output)).toMatch(/ally/);
    r = run(r.state, "set_disposition", { monster_id: "m1", disposition: "neutral" });
    expect(m(r.state, "m1")).toMatchObject({ ally: false, neutral: true });
    expect(JSON.stringify(r.outcome.output)).toMatch(/neutral/);
    r = run(r.state, "set_disposition", { monster_id: "m1", disposition: "foe" });
    expect(m(r.state, "m1")).toMatchObject({ ally: false, neutral: false });
    expect(JSON.stringify(r.outcome.output)).toMatch(/foe/);
  });

  it("an unknown id is an error", () => {
    expect(refusal(() => run(base(), "set_disposition", { monster_id: "mon_gone", disposition: "ally" }))).toMatch(/mon_gone|unknown|no .*creature/i);
  });

  /** Bram 20, Kobold 1 15, Kobold 2 10; Kobold 2's turn. Tikk is not in the order. */
  function fight(): GameState {
    const s = base();
    s.combat = {
      active: true,
      round: 1,
      turnIndex: 2,
      order: [
        { entityId: "pc_a", entityType: "character", name: "Bram", initiative: 20 },
        { entityId: "m1", entityType: "monster", name: "Kobold 1", initiative: 15 },
        { entityId: "m2", entityType: "monster", name: "Kobold 2", initiative: 10 },
      ],
      turn: null,
      reactionsUsed: [],
    };
    return s;
  }

  it("in combat, neutral removes it from the order and keeps the current turn", () => {
    const s = run(fight(), "set_disposition", { monster_id: "m1", disposition: "neutral" }).state;
    expect(s.combat.order.map((o) => o.entityId)).toEqual(["pc_a", "m2"]);
    expect(s.combat.order[s.combat.turnIndex].entityId).toBe("m2");
  });

  it("in combat, combatant: false removes an ally from the order", () => {
    const s = run(fight(), "set_disposition", { monster_id: "m1", disposition: "ally", combatant: false }).state;
    expect(m(s, "m1")).toMatchObject({ ally: true, combatant: false });
    expect(s.combat.order.map((o) => o.entityId)).toEqual(["pc_a", "m2"]);
    expect(s.combat.order[s.combat.turnIndex].entityId).toBe("m2");
  });

  it("in combat, a non-member made a combatant ally joins the order at its rolled initiative", () => {
    // Tikk rolls 12 (+0): between Kobold 1 (15) and Kobold 2 (10).
    const s = run(fight(), "set_disposition", { monster_id: "m3", disposition: "ally", combatant: true }, seq(12)).state;
    expect(m(s, "m3")).toMatchObject({ ally: true, neutral: false, combatant: true });
    expect(s.combat.order.map((o) => o.entityId)).toEqual(["pc_a", "m1", "m3", "m2"]);
    expect(s.combat.order.find((o) => o.entityId === "m3")!.initiative).toBe(12);
    expect(s.combat.order[s.combat.turnIndex].entityId).toBe("m2");
  });
});
