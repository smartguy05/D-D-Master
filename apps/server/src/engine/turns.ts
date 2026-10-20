import type { Character, GameState, Monster } from "@dm/shared";
import { speedOf } from "./economy.js";

/** The creature holding the current combat turn when the DM plays it (a monster or an NPC). */
export function dmCreatureTurn(state: GameState): Monster | undefined {
  if (!state.combat.active) return undefined;
  const cur = state.combat.order[state.combat.turnIndex];
  if (!cur || cur.entityType !== "monster") return undefined;
  const m = state.monsters.find((x) => x.id === cur.entityId);
  return m && m.hp > 0 ? m : undefined;
}

/** Returned by start_combat/next_turn on a DM-played turn: the model tends to announce it and stop. */
export function dmTurnInstruction(m: Monster): string {
  const who = m.ally ? `${m.name} is on the party's side; you play it.` : `You play ${m.name}.`;
  const speed = speedOf(m);
  const budget = `It can move up to ${speed} ft (${speed / 5} squares) and make ${m.attacksPerAction > 1 ? `${m.attacksPerAction} attacks (Multiattack)` : "one attack"} with its action.`;
  return `${who} ${budget} Take its whole turn now in this same reply, without waiting for the players: move_token if it moves, roll_dice its attack (roller_id, target_id, attack_name), apply_damage on a hit, one or two sentences of narration, then next_turn. Keep going until a player character's turn.`;
}

/** The creatures the party fights: monsters that are neither allies nor neutral (dead ones included). */
export function foesOf(state: GameState): Monster[] {
  return state.monsters.filter((x) => !x.ally && !x.neutral);
}

/**
 * The foes of the current combat: foesOf, minus corpses outside its initiative order (the dead of an
 * earlier fight in the same scene), so they never make a new combat look won. A living foe counts
 * (a reinforcement spawned mid-fight) unless it sits the fight out (`combatant: false`, e.g. a
 * hostile NPC looking on) and is not in the order. Empty out of combat.
 */
export function combatFoes(state: GameState): Monster[] {
  if (!state.combat.active) return [];
  const inOrder = new Set(state.combat.order.filter((o) => o.entityType === "monster").map((o) => o.entityId));
  return foesOf(state).filter((m) => inOrder.has(m.id) || (m.hp > 0 && m.combatant !== false));
}

const isDeadPc = (c: Character) => c.conditions.some((x) => x.toLowerCase() === "dead");

/** PCs at 0 HP still making death saves (not Stable, not Dead): their saves need combat turns. */
export function dyingCharacters(state: GameState): GameState["characters"] {
  return state.characters.filter((c) => c.hp <= 0 && !c.deathSaves.stable && !isDeadPc(c));
}

/**
 * The PC holding the current combat turn when they can't take it: Dead, or down at 0 HP
 * (unconscious, stable or not) with no death save of theirs still waiting on physical dice.
 */
export function incapableTurn(state: GameState): Character | undefined {
  if (!state.combat.active) return undefined;
  const cur = state.combat.order[state.combat.turnIndex];
  const pc = cur && state.characters.find((c) => c.id === cur.entityId);
  if (!pc || pc.hp > 0) return undefined;
  const waiting = state.pendingRoll?.characterId === pc.id && state.pendingRoll.kind === "death_save";
  return isDeadPc(pc) || !waiting ? pc : undefined;
}

/** Someone in the initiative order who could take a turn: a living foe or ally, or a PC above 0 HP. */
export function anyoneCanAct(state: GameState): boolean {
  return state.combat.order.some((o) =>
    o.entityType === "character"
      ? state.characters.some((c) => c.id === o.entityId && c.hp > 0 && !isDeadPc(c))
      : state.monsters.some((m) => m.id === o.entityId && m.hp > 0),
  );
}

/**
 * For DmSession's stall check after a speech-only reply: the DM-played turn that is still open
 * (`key` changes with every turn), a turn held by a PC who can't act, or undefined when a player
 * character acts or there is no combat.
 */
export function stalledTurn(state: GameState): { key: string; prompt: string } | undefined {
  // Every foe is down but the initiative strip is still up: the DM said "the fight is over" without end_combat.
  // Not while a PC is dying (death saves need the turns) or before any foe was there to beat.
  const foes = combatFoes(state);
  const dying = dyingCharacters(state).length > 0;
  if (state.combat.active && foes.length && !foes.some((x) => x.hp > 0) && !dying)
    return {
      key: `end:${state.combat.order.map((o) => o.entityId).join(",")}`,
      prompt: "[Combat: no foe is left standing. If the fight is over, call end_combat now (the initiative strip is still on the TV); otherwise continue the turn.]",
    };
  // A PC dropped on their own turn (a reaction, a trap): the turn is over but nobody passed it.
  const down = incapableTurn(state);
  if (down && anyoneCanAct(state))
    return {
      key: `${state.combat.round}:${state.combat.turnIndex}:${down.id}`,
      prompt: `[Combat: it is ${down.name}'s turn but they can't act (${isDeadPc(down) ? "dead" : "unconscious at 0 HP"}). Call next_turn now.]`,
    };
  const m = dmCreatureTurn(state);
  if (!m) return undefined;
  return {
    key: `${state.combat.round}:${state.combat.turnIndex}:${m.id}`,
    prompt: `[Combat: it is still ${m.name}'s turn and you stopped. If its turn is already over, call next_turn now. Otherwise: ${dmTurnInstruction(m)} Don't repeat what you just said.]`,
  };
}
