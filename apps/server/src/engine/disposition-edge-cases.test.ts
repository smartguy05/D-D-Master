import { describe, expect, it } from "vitest";
import { Character, emptyGameState, Monster, type GameState, type Rng } from "@dm/shared";
import { executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";

/** Edge cases of allies, set_disposition and add_npc combatant (from the adversarial review of the 2026-10-19 fixes). */

const seq =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

function ctx(rng: Rng = seq(10)): EngineContext {
  return {
    rng,
    monsterTemplate: (name) =>
      name.toLowerCase() === "veteran"
        ? { name: "Veteran", srdName: "Veteran", maxHp: 65, ac: 17, initiativeBonus: 1, speed: 30, attacksPerAction: 2, attacks: [], conditions: [], hidden: false, npc: false, appearance: "", ally: false, follows: false, combatant: true, neutral: false, conditionMeta: [] }
        : undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [{ id: "loc_shore", name: "Shore", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 12, gridH: 8 }],
  };
}

const run = (s: GameState, tool: string, args: unknown, rng?: Rng) => executeEngineTool(s, tool as EngineTool, args, ctx(rng));
const m = (s: GameState, id: string) => s.monsters.find((x) => x.id === id)!;

function party(): GameState {
  let s = emptyGameState("c1");
  s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Bram", maxHp: 12, hp: 12 }));
  s = run(s, "change_scene", { location_id: "loc_shore" }).state;
  return s;
}

describe("add_npc called again for an existing NPC", () => {
  it("moving a bodyguard (combatant=true) with add_npc keeps it a combatant", () => {
    let s = run(party(), "add_npc", { name: "Captain Mara Venn", stat_block: "Veteran", combatant: true }).state;
    const id = s.monsters[0].id;
    expect(m(s, id).combatant).toBe(true);
    // Later the DM only repositions her (the documented "add_npc again ... moves it if x/y are given").
    s = run(s, "add_npc", { name: "Captain Mara Venn", x: 2, y: 2 }).state;
    expect(m(s, id).combatant).toBe(true);
  });

  it("re-calling add_npc for a hostile NPC (to move it) does not turn it into an ally", () => {
    let s = run(party(), "add_npc", { name: "Smuggler Rook", appearance: "wiry smuggler", ally: false, combatant: true }).state;
    const id = s.monsters[0].id;
    s = run(s, "add_npc", { name: "Smuggler Rook", x: 3, y: 3 }).state;
    expect(m(s, id).ally).toBe(false);
  });
});

describe("set_disposition on a knocked-out ally", () => {
  it("an Unconscious 0-HP ally turned foe is Dead (foes at 0 HP are dead), not a 0-HP Unconscious foe", () => {
    const s = party();
    s.monsters.push(Monster.parse({ id: "m_pell", name: "Pell", npc: true, ally: true, maxHp: 4, hp: 4 }));
    let r = run(s, "apply_damage", { target_id: "m_pell", amount: 9 }).state;
    expect(m(r, "m_pell").conditions).toContain("Unconscious");
    r = run(r, "set_disposition", { monster_id: "m_pell", disposition: "foe" }).state;
    expect(m(r, "m_pell").conditions).toContain("Dead");
    expect(m(r, "m_pell").conditions).not.toContain("Unconscious");
  });
});

describe("set_disposition removing the current creature", () => {
  it("when the last creature in the order leaves on its own turn, the turn wraps to a NEW round", () => {
    const s = party();
    s.monsters.push(Monster.parse({ id: "m1", name: "Bandit", maxHp: 11, hp: 11, ac: 12 }));
    s.combat = {
      active: true,
      round: 1,
      turnIndex: 1,
      order: [
        { entityId: "pc_a", entityType: "character", name: "Bram", initiative: 15 },
        { entityId: "m1", entityType: "monster", name: "Bandit", initiative: 8 },
      ],
      turn: null,
      reactionsUsed: [],
    };
    // The bandit surrenders on its turn: it leaves the order and Bram is up next — in round 2.
    const r = run(s, "set_disposition", { monster_id: "m1", disposition: "neutral" }).state;
    expect(r.combat.order[r.combat.turnIndex].entityId).toBe("pc_a");
    expect(r.combat.round).toBe(2);
  });
});

describe("code-review follow-ups", () => {
  function fight(): GameState {
    let s = party();
    s = run(s, "add_npc", { name: "Pell", combatant: true }).state;
    s = run(s, "add_npc", { name: "Bandit", ally: false }).state;
    return run(s, "start_combat", {}, seq(15, 10, 5)).state;
  }

  it("a hostile NPC from add_npc fights by default; a friendly one doesn't", () => {
    let s = party();
    s = run(s, "add_npc", { name: "Bandit", ally: false }).state;
    s = run(s, "add_npc", { name: "Shopkeeper" }).state;
    const order = run(s, "start_combat", {}).state.combat.order.map((o) => o.name);
    expect(order).toContain("Bandit");
    expect(order).not.toContain("Shopkeeper");
  });

  it("an NPC added (or turned combatant) with add_npc mid-fight joins the initiative order", () => {
    let s = fight();
    s = run(s, "add_npc", { name: "Guard", combatant: true }).state;
    expect(s.combat.order.map((o) => o.name)).toContain("Guard");
  });

  it("a knocked-out ally made neutral stays Unconscious, not Dead", () => {
    let s = fight();
    const pell = s.monsters.find((x) => x.name === "Pell")!.id;
    s = run(s, "apply_damage", { target_id: pell, amount: 50 }).state;
    s = run(s, "set_disposition", { monster_id: pell, disposition: "neutral" }).state;
    expect(m(s, pell).conditions).toEqual(["Unconscious"]);
  });

  it("party status says which creatures are neutral or out of combat", () => {
    let s = party();
    s = run(s, "add_npc", { name: "Shopkeeper" }).state;
    s = run(s, "set_disposition", { monster_id: s.monsters[0].id, disposition: "neutral" }).state;
    expect(JSON.stringify(run(s, "get_party_status", {}).outcome.output)).toMatch(/"neutral":true.*"out_of_combat":true/);
  });

  it("when the current creature leaves the fight, the next creature's turn starts (death save)", () => {
    let s = fight();
    const bandit = s.monsters.find((x) => x.name === "Bandit")!;
    s.characters[0].hp = 0;
    s.characters[0].conditions = ["Unconscious"];
    s.combat.order = [
      { entityId: bandit.id, entityType: "monster", name: "Bandit", initiative: 18 },
      { entityId: "pc_a", entityType: "character", name: "Bram", initiative: 12 },
    ];
    s.combat.turnIndex = 0;
    s.combat.turn = null;
    const r = run(s, "set_disposition", { monster_id: bandit.id, disposition: "neutral" });
    expect(r.state.combat.order.map((o) => o.entityId)).toEqual(["pc_a"]);
    expect(r.outcome.output).toMatchObject({ next_turn: "Bram", death_save: expect.anything() });
  });
});
