import { describe, expect, it } from "vitest";
import type { GameState, Monster } from "@dm/shared";
import { executeEngineTool, type EngineContext, type EngineTool } from "./tools.js";
import { attacksPerActionOf, moveCost, speedOf } from "./economy.js";
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

const fighter = (over = {}) => makeCharacter({ id: "pc_f", name: "Thorin", className: "Fighter", speed: 30, ...over });
const wizard = (over = {}) =>
  makeCharacter({
    id: "pc_w",
    name: "Lyra",
    className: "Wizard",
    level: 5,
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    spellSlots: [{ level: 1, max: 4, used: 0 }, { level: 2, max: 3, used: 0 }, { level: 3, max: 2, used: 0 }],
    ...over,
  });

/** Combat already running in the given order (first entry acts), every creature with a token. */
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

function run(s: GameState, name: EngineTool, args: unknown, c: EngineContext = rulesCtx(seq(15))) {
  const r = executeEngineTool(s, name, args, c);
  return { state: r.state, out: r.outcome.output as Out, rolls: r.outcome.rolls };
}

const attack = (roller: string, target: string, extra = {}) => ({ notation: "1d20+5", label: "attack", roller_id: roller, target_id: target, attack_name: "Longsword", ...extra });
const playerAttack = (pc: string, target: string, extra = {}) => ({ character_id: pc, notation: "1d20+5", label: "Longsword attack", target_id: target, attack_name: "Longsword", ...extra });

describe("turn economy helpers", () => {
  it("costs 5 ft per square, diagonals included", () => {
    expect(moveCost({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(15);
    expect(moveCost({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(15);
    expect(moveCost({ x: 5, y: 5 }, { x: 1, y: 7 })).toBe(20);
  });

  it("takes Speed 0 from Grappled/Restrained/Unconscious and Extra Attack tiers from features", () => {
    expect(speedOf(fighter())).toBe(30);
    expect(speedOf(fighter({ conditions: ["grappled"] }))).toBe(0);
    expect(speedOf(goblin({ conditions: ["Restrained"] }))).toBe(0);
    expect(attacksPerActionOf(fighter())).toBe(1);
    expect(attacksPerActionOf(fighter({ features: ["Extra Attack"] }))).toBe(2);
    expect(attacksPerActionOf(fighter({ features: ["Extra Attack", "Two Extra Attacks"] }))).toBe(3);
    expect(attacksPerActionOf(goblin({ attacksPerAction: 2 }))).toBe(2);
  });
});

describe("turn budget", () => {
  it("starts a budget on start_combat and a fresh one, reaction back, on the creature's next turn", () => {
    let s = stateWith(fighter({ abilities: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 10 } }));
    s = run(s, "start_combat", {}, rulesCtx(seq(20))).state;
    expect(s.combat.turn).toMatchObject({ entityId: "pc_f", round: 1, speed: 30, movementUsed: 0, action: false });
    s = run(s, "take_action", { kind: "dodge" }).state;
    s.combat.reactionsUsed = ["pc_f"];
    // Alone in the order: next_turn starts round 2 on the same creature.
    s = run(s, "next_turn", {}).state;
    expect(s.combat.turn).toMatchObject({ entityId: "pc_f", round: 2, action: false, dodging: false });
    expect(s.combat.reactionsUsed).toEqual([]);
    s = run(s, "end_combat", {}).state;
    expect(s.combat.turn).toBeNull();
  });

  it("refuses a move past the creature's Speed, allows it with override, and counts what was walked", () => {
    let s = inCombat(["pc_f", "m1"], fighter());
    // Thorin at (2,2): 6 squares = 30 ft is fine, then 1 more square is refused.
    let r = run(s, "move_token", { entity_id: "pc_f", x: 8, y: 0 });
    expect(r.out.error).toBeUndefined();
    s = r.state;
    expect(s.combat.turn?.movementUsed).toBe(30);
    r = run(s, "move_token", { entity_id: "pc_f", x: 9, y: 0 });
    expect(r.out).toMatchObject({ refused: "turn_economy", budget: { movement_left_ft: 0 } });
    expect(r.out.error).toMatch(/0 ft of movement left/);
    expect(r.state.tokens.find((t) => t.entityId === "pc_f")).toMatchObject({ x: 8, y: 0 });
    r = run(s, "move_token", { entity_id: "pc_f", x: 9, y: 0, override: true });
    expect(r.state.tokens.find((t) => t.entityId === "pc_f")).toMatchObject({ x: 9, y: 0 });
  });

  it("doubles movement with Dash, and a second Dash needs the bonus action (Cunning Action)", () => {
    let s = inCombat(["pc_f", "m1"], fighter());
    s = run(s, "take_action", { kind: "dash" }).state;
    let r = run(s, "move_token", { entity_id: "pc_f", x: 14, y: 2 }); // 12 squares = 60 ft
    expect(r.out.error).toBeUndefined();
    s = r.state;
    r = run(s, "take_action", { kind: "dash" });
    expect(r.out.error).toMatch(/already used their action/);
    s = run(s, "take_action", { kind: "dash", cost: "bonus_action" }).state;
    expect(s.combat.turn).toMatchObject({ extraMovement: 60, movementUsed: 60, bonusAction: true });
  });

  it("refuses moves and attacks off-turn, but an opportunity attack works once per round as a reaction", () => {
    let s = inCombat(["m1", "pc_f"], fighter());
    expect(run(s, "move_token", { entity_id: "pc_f", x: 3, y: 3 }).out.error).toMatch(/not Thorin's turn/);
    const r = run(s, "request_player_roll", playerAttack("pc_f", "m1"));
    expect(r.out.error).toMatch(/It's not Thorin's turn, it's Goblin's.*reaction/);
    expect(r.rolls).toHaveLength(0);
    s = run(s, "request_player_roll", playerAttack("pc_f", "m1", { action_type: "reaction" })).state;
    expect(s.combat.reactionsUsed).toEqual(["pc_f"]);
    expect(run(s, "request_player_roll", playerAttack("pc_f", "m1", { action_type: "reaction" })).out.error).toMatch(/already used their reaction/);
    // The goblin's own action is untouched by Thorin's reaction.
    expect(s.combat.turn).toMatchObject({ entityId: "m1", action: false });
  });

  it("allows one attack without Extra Attack, two with it, and the bonus action separately", () => {
    let s = inCombat(["pc_f", "m1"], fighter());
    s = run(s, "request_player_roll", playerAttack("pc_f", "m1")).state;
    expect(run(s, "request_player_roll", playerAttack("pc_f", "m1")).out.error).toMatch(/already used their action this turn \(made 1 of 1 attack/);
    s = run(s, "request_player_roll", playerAttack("pc_f", "m1", { action_type: "bonus_action" })).state;
    expect(s.combat.turn).toMatchObject({ action: true, bonusAction: true, attacksUsed: 1 });

    let t = inCombat(["pc_f", "m1"], fighter({ features: ["Extra Attack"] }));
    t = run(t, "request_player_roll", playerAttack("pc_f", "m1")).state;
    t = run(t, "request_player_roll", playerAttack("pc_f", "m1")).state;
    expect(t.combat.turn).toMatchObject({ attacksUsed: 2 });
    expect(run(t, "request_player_roll", playerAttack("pc_f", "m1")).out.error).toMatch(/made 2 of 2 attacks/);
  });

  it("counts a monster's roll_dice attacks against its Multiattack, and ignores damage rolls", () => {
    let s = inCombat(["m1", "pc_f"], fighter());
    s.monsters[0].attacksPerAction = 2;
    s = run(s, "roll_dice", attack("m1", "pc_f")).state;
    s = run(s, "roll_dice", { notation: "1d6+2", label: "Scimitar damage", roller_id: "m1", target_id: "pc_f" }).state;
    s = run(s, "roll_dice", attack("m1", "pc_f")).state;
    expect(s.combat.turn).toMatchObject({ attacksUsed: 2 });
    expect(run(s, "roll_dice", attack("m1", "pc_f")).out.error).toMatch(/Goblin already used their action/);
    // Without roller_id an attack belongs to the creature whose turn it is.
    expect(run(s, "roll_dice", { ...attack("m1", "pc_f"), roller_id: undefined }).out.error).toMatch(/Goblin already used/);
  });

  it("an override past a spent action is a new Attack action (Action Surge)", () => {
    let s = inCombat(["pc_f", "m1"], fighter({ features: ["Extra Attack"] }));
    s = run(s, "request_player_roll", playerAttack("pc_f", "m1")).state;
    s = run(s, "request_player_roll", playerAttack("pc_f", "m1")).state;
    s = run(s, "request_player_roll", playerAttack("pc_f", "m1", { override: true })).state;
    expect(s.combat.turn).toMatchObject({ attacksUsed: 1 });
    expect(run(s, "request_player_roll", playerAttack("pc_f", "m1")).out.error).toBeUndefined();
  });

  it("spends the action, bonus action or reaction a spell's casting time needs", () => {
    let s = inCombat(["pc_w", "m1"], wizard());
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Misty Step" }).state;
    expect(s.combat.turn).toMatchObject({ bonusAction: true, action: false });
    s = run(s, "cast_spell", { caster_id: "pc_w", spell: "Fire Bolt", target_ids: ["m1"] }).state;
    expect(s.combat.turn).toMatchObject({ action: true });
    const r = run(s, "cast_spell", { caster_id: "pc_w", spell: "Magic Missile", target_ids: ["m1"] });
    expect(r.out.error).toMatch(/already used their action/);
    expect(r.state.characters[0].spellSlots[0].used).toBe(0); // refused: no slot spent

    // Shield on the goblin's turn: a reaction, allowed off-turn, once.
    let t = inCombat(["m1", "pc_w"], wizard());
    t = run(t, "cast_spell", { caster_id: "pc_w", spell: "Shield" }).state;
    expect(t.combat.reactionsUsed).toEqual(["pc_w"]);
    expect(run(t, "cast_spell", { caster_id: "pc_w", spell: "Fire Bolt", target_ids: ["m1"] }).out.error).toMatch(/not Lyra's turn/);
  });

  it("doesn't spend the action when the tool itself fails", () => {
    const s = inCombat(["pc_w", "m1"], wizard({ spellSlots: [{ level: 1, max: 1, used: 1 }] }));
    const r = run(s, "cast_spell", { caster_id: "pc_w", spell: "Magic Missile", target_ids: ["m1"] });
    expect(r.out.error).toMatch(/no level 1 slot/);
    expect(r.state.combat.turn).toMatchObject({ action: false });
  });

  it("never checks the host, creatures outside the order, or anything out of combat", () => {
    const s = inCombat(["m1", "pc_f"], fighter());
    const host = run(s, "move_token", { entity_id: "pc_f", x: 20, y: 10 }, { ...rulesCtx(), source: "host" });
    expect(host.out.error).toBeUndefined();
    s.monsters.push(goblin({ id: "m2", name: "Late Goblin" }));
    s.tokens.push({ id: "tok_m2", entityId: "m2", entityType: "monster", x: 0, y: 7, size: 1 });
    expect(run(s, "move_token", { entity_id: "m2", x: 20, y: 7 }).out.error).toBeUndefined();
    const calm = stateWith(fighter());
    calm.tokens.push({ id: "t", entityId: "pc_f", entityType: "character", x: 0, y: 0, size: 1 });
    expect(run(calm, "move_token", { entity_id: "pc_f", x: 20, y: 10 }).out.error).toBeUndefined();
    expect(run(calm, "take_action", { entity_id: "pc_f", kind: "dash" }).out).toMatchObject({ note: /Not in combat/ });
  });

  it("refuses actions of an incapacitated creature and shows the budget in party status", () => {
    const s = inCombat(["pc_f", "m1"], fighter({ conditions: ["Stunned"] }));
    expect(run(s, "take_action", { kind: "help" }).out.error).toMatch(/Stunned and can't take actions/);
    const status = run(s, "get_party_status", {}).out as { combat: { turn: unknown } };
    expect(status.combat.turn).toMatchObject({ creature: "Thorin", movement_left_ft: 30, action: "available", reaction: "available" });
  });
});
