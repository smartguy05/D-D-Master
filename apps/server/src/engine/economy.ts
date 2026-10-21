import {
  actionSpent,
  movementLeft,
  TurnBudget,
  type Character,
  type GameState,
  type Monster,
  type SpellInfo,
  type ToolArgsOf,
} from "@dm/shared";
import { findCombatant, tokenFor } from "./state.js";
import { isAttackRoll } from "./rolls.js";
import { isIncapacitating } from "./rules/vitals.js";
import { planMove } from "./movement.js";
import type { EngineContext } from "./tools.js";

/**
 * Combat turn economy (SRD Playing the Game, "Your Turn"): on its turn a creature can move up to its
 * Speed and take one action; it may also take one bonus action, and one reaction per round (reset
 * at the start of its turn). The engine tracks this in `combat.turn` / `combat.reactionsUsed`.
 * DM calls that exceed it are refused with a message the DM reads out; `override` lets a real
 * exception through (Action Surge, Haste...) and the host's console is never checked.
 */

export type Cost = "action" | "bonus_action" | "reaction";

/** SRD conditions with "Speed 0": Grappled, Paralyzed, Petrified, Restrained, Unconscious (and Dead). */
const SPEED_ZERO = ["grappled", "paralyzed", "petrified", "restrained", "unconscious", "dead"];

export function speedOf(e: Character | Monster): number {
  return e.conditions.some((c) => SPEED_ZERO.includes(c.trim().toLowerCase())) ? 0 : e.speed;
}

/** Extra Attack (2), Two Extra Attacks (3), Three Extra Attacks (4); a monster's Multiattack count. */
export function attacksPerActionOf(e: Character | Monster): number {
  if ("attacksPerAction" in e) return e.attacksPerAction;
  const has = (name: string) => e.features.some((f) => f.trim().toLowerCase() === name);
  if (has("three extra attacks")) return 4;
  if (has("two extra attacks")) return 3;
  return has("extra attack") ? 2 : 1;
}

/** Feet to walk between two cells: each square, diagonal or not, costs 5 ft (SRD "Entering a Square"). */
export function moveCost(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) * 5;
}

function currentEntry(state: GameState) {
  return state.combat.active ? state.combat.order[state.combat.turnIndex] : undefined;
}

/**
 * Keep `combat.turn` on the creature whose turn it is (mutates the cloned state). A new creature or
 * a new round gets a fresh budget and its reaction back; out of combat everything is cleared.
 */
export function syncTurn(state: GameState): void {
  const combat = state.combat;
  const cur = currentEntry(state);
  if (!cur) {
    combat.turn = null;
    combat.reactionsUsed = [];
    return;
  }
  const entity = findCombatant(state, cur.entityId)?.entity;
  if (!combat.turn || combat.turn.entityId !== cur.entityId || combat.turn.round !== combat.round) {
    combat.turn = TurnBudget.parse({ entityId: cur.entityId, round: combat.round, attacksPerAction: entity ? attacksPerActionOf(entity) : 1 });
    combat.reactionsUsed = combat.reactionsUsed.filter((id) => id !== cur.entityId);
  }
  if (entity) combat.turn.speed = speedOf(entity);
}

/** What the DM sees with a refusal and in party status. */
export function budgetView(state: GameState) {
  const b = state.combat.turn;
  if (!b) return undefined;
  const name = findCombatant(state, b.entityId)?.entity.name ?? b.entityId;
  return {
    creature: name,
    movement_left_ft: movementLeft(b),
    action: actionSpent(b) ? "used" : b.action ? `${b.attacksPerAction - b.attacksUsed} attack(s) left` : "available",
    bonus_action: b.bonusAction ? "used" : "available",
    reaction: state.combat.reactionsUsed.includes(b.entityId) ? "used" : "available",
    disengaged: b.disengaged || undefined,
    dodging: b.dodging || undefined,
  };
}

/** A creature the economy applies to: combat is on, the DM is calling, and it is in the initiative order. */
function tracked(state: GameState, ctx: EngineContext, idOrName: string | undefined) {
  if (!state.combat.active || ctx.source === "host" || !idOrName) return undefined;
  const c = findCombatant(state, idOrName);
  if (!c || !state.combat.order.some((o) => o.entityId === c.entity.id)) return undefined;
  return { id: c.entity.id, name: c.entity.name, entity: c.entity, current: currentEntry(state)?.entityId === c.entity.id };
}

type Actor = NonNullable<ReturnType<typeof tracked>>;

const costName = (cost: Cost) => (cost === "bonus_action" ? "bonus action" : cost);

/** Why `actor` can't spend `cost` now (undefined: it can). An attack may reuse an Attack action with swings left. */
function refusal(state: GameState, actor: Actor, cost: Cost, attack: boolean, spellRoll = false): string | undefined {
  const incap = actor.entity.conditions.find(isIncapacitating);
  if (incap) return `${actor.name} is ${incap} and can't take actions or reactions.`;
  if (cost === "reaction")
    return state.combat.reactionsUsed.includes(actor.id) ? `${actor.name} already used their reaction this round; it comes back at the start of their turn.` : undefined;
  const cur = currentEntry(state);
  if (!actor.current) {
    const hint = attack ? ' An opportunity attack is a reaction: pass action_type "reaction".' : "";
    return `It's not ${actor.name}'s turn, it's ${cur ? (findCombatant(state, cur.entityId)?.entity.name ?? cur.name) : "nobody"}'s.${hint}`;
  }
  const b = state.combat.turn!;
  if (cost === "bonus_action") return b.bonusAction ? `${actor.name} already used their bonus action this turn.` : undefined;
  if (attack && spellRoll) return undefined;
  if (attack && b.action && b.attacksUsed > 0 && b.attacksUsed < b.attacksPerAction) return undefined;
  if (!b.action) return undefined;
  const swings = b.attacksUsed > 0 ? ` (made ${b.attacksUsed} of ${b.attacksPerAction} attack${b.attacksPerAction > 1 ? "s" : ""} with it)` : "";
  return `${actor.name} already used their action this turn${swings}. They can still move ${movementLeft(b)} ft${b.bonusAction ? "" : " or use a bonus action"}.`;
}

/** Record the spend (after the tool succeeded). An override past a spent action is a new action (Action Surge). */
function spend(state: GameState, actor: Actor, cost: Cost, attack: boolean, spellRoll = false) {
  if (cost === "reaction") {
    if (!state.combat.reactionsUsed.includes(actor.id)) state.combat.reactionsUsed.push(actor.id);
    return;
  }
  const b = state.combat.turn;
  if (!actor.current || !b) return; // an overridden off-turn action: nothing of the current turn to spend
  if (cost === "bonus_action") {
    b.bonusAction = true;
    return;
  }
  if (attack && spellRoll) {
    b.spellAttacks -= 1; // the spell's own attack roll: cast_spell already spent its action
    return;
  }
  if (attack && b.action && b.attacksUsed > 0 && b.attacksUsed < b.attacksPerAction) {
    b.attacksUsed += 1;
    return;
  }
  b.action = true;
  b.attacksUsed = attack ? 1 : b.attacksPerAction;
}

function refused(state: GameState, message: string) {
  return { error: message, refused: "turn_economy", budget: budgetView(state), retry: "If a feature really allows it, call again with override: true." };
}

/**
 * Pre-check for a DM tool (roll_dice/request_player_roll attacks, cast_spell, move_token). Returns
 * a refusal to send instead of running the tool, or a `commit` to run after it succeeded.
 */
export interface Gate {
  refusal?: Record<string, unknown>;
  commit?: (state: GameState) => void;
}

const norm = (s: string) => s.trim().toLowerCase();

/** This attack roll is one the spell cast this turn still owes: attack_name/label name the spell (a word of it, "Ray 2") or say "spell". */
function isSpellRoll(state: GameState, actor: Actor | undefined, what: string): boolean {
  const b = state.combat.turn;
  if (!actor?.current || !b || b.spellAttacks <= 0) return false;
  const words = new Set(norm(what).split(/[^a-z]+/));
  if (words.has("spell")) return true;
  return norm(b.spellAttackSpell)
    .split(/[^a-z]+/)
    .some((w) => w.length >= 3 && w !== "the" && words.has(w));
}

function gateUse(state: GameState, actor: Actor | undefined, cost: Cost, attack: boolean, override: boolean, spellRoll = false): Gate | undefined {
  if (!actor) return undefined;
  if (!override) {
    const why = refusal(state, actor, cost, attack, spellRoll);
    if (why) return { refusal: refused(state, why) };
  }
  return { commit: (s) => spend(s, actor, cost, attack, spellRoll) };
}

export function spellCost(spell: SpellInfo): Cost {
  if (spell.reaction) return "reaction";
  return spell.bonusAction ? "bonus_action" : "action";
}

export function economyGate(state: GameState, name: string, args: unknown, ctx: EngineContext): Gate | undefined {
  if (!state.combat.active || ctx.source === "host") return undefined;
  switch (name) {
    case "roll_dice": {
      const a = args as ToolArgsOf<"roll_dice">;
      if (!isAttackRoll(a.notation, a.target_id, a.label)) return undefined;
      const actor = tracked(state, ctx, a.roller_id) ?? tracked(state, ctx, currentEntry(state)?.entityId);
      return gateUse(state, actor, a.action_type ?? "action", true, a.override, isSpellRoll(state, actor, `${a.attack_name ?? ""} ${a.label}`));
    }
    case "request_player_roll": {
      const a = args as ToolArgsOf<"request_player_roll">;
      if (a.kind === "damage" || !isAttackRoll(a.notation, a.target_id, a.label)) return undefined;
      const actor = tracked(state, ctx, a.character_id);
      return gateUse(state, actor, a.action_type ?? "action", true, a.override, isSpellRoll(state, actor, `${a.attack_name ?? ""} ${a.label}`));
    }
    case "cast_spell": {
      const a = args as ToolArgsOf<"cast_spell">;
      const spell = ctx.spell(a.spell);
      if (!spell) return undefined; // cast_spell reports the unknown name
      return gateUse(state, tracked(state, ctx, a.caster_id), spellCost(spell), false, a.override);
    }
    case "move_token":
      return gateMove(state, ctx, args as ToolArgsOf<"move_token">);
  }
  return undefined;
}

function gateMove(state: GameState, ctx: EngineContext, a: ToolArgsOf<"move_token">): Gate | undefined {
  const actor = tracked(state, ctx, a.entity_id);
  const token = actor && tokenFor(state, actor.id);
  if (!actor || !token || token.x < 0 || token.y < 0) return undefined; // first placement: no walk
  const from = { x: token.x, y: token.y };
  const b = state.combat.turn!;
  // The squares of the route the handler will walk (around walls), not the straight line.
  const plan = planMove(state, ctx, actor.id, a.x, a.y, a.ignore_terrain);
  const cost = plan.squares * 5;
  if (!a.override) {
    if (!actor.current) return { refusal: refused(state, `It's not ${actor.name}'s turn; they can't move now.`) };
    const left = movementLeft(b);
    if (cost > left) {
      const route = plan.around ? "that route around the walls is" : "that move is";
      const why =
        b.speed === 0
          ? `${actor.name} can't move: their Speed is 0 (${actor.entity.conditions.join(", ")}).`
          : `${actor.name} has ${left} ft of movement left this turn; ${route} ${cost} ft (${cost / 5} squares). Move fewer squares${actionSpent(b) ? "" : ", or take the Dash action (take_action kind dash) for more"}.`;
      return { refusal: refused(state, why) };
    }
  }
  return {
    commit: (s) => {
      const turn = s.combat.turn;
      const t = tokenFor(s, actor.id);
      if (!turn || turn.entityId !== actor.id || !t || (t.x === from.x && t.y === from.y)) return;
      turn.movementUsed += cost;
    },
  };
}

/** take_action: spend a slot on Dash, Dodge, Disengage, Help, Hide... (state is the cloned copy). */
export function takeAction(state: GameState, a: ToolArgsOf<"take_action">, ctx: EngineContext) {
  if (!state.combat.active) return { ok: true, note: "Not in combat: actions aren't tracked." };
  const who = a.entity_id ?? currentEntry(state)?.entityId;
  const c = who ? findCombatant(state, who) : undefined;
  if (!c) throw new Error(`Unknown creature "${a.entity_id}".`);
  const actor = tracked(state, ctx, c.entity.id);
  const label = `${a.kind}${a.note ? ` (${a.note})` : ""}`;
  if (!actor) return { name: c.entity.name, took: label, note: "Not in the initiative order: not tracked." };
  const gate = gateUse(state, actor, a.cost, false, a.override)!;
  if (gate.refusal) return gate.refusal;
  gate.commit!(state);
  const b = state.combat.turn;
  if (actor.current && b) {
    if (a.kind === "dash") b.extraMovement += speedOf(actor.entity);
    if (a.kind === "disengage") b.disengaged = true;
    if (a.kind === "dodge") b.dodging = true;
  }
  return { name: actor.name, took: label, cost: costName(a.cost), budget: budgetView(state) };
}

/** True for a handler result that reports a failure ({ error }); the spend is then not recorded. */
export function isErrorOutput(output: unknown): boolean {
  return !!output && typeof output === "object" && "error" in output && (output as { error?: unknown }).error !== undefined;
}
