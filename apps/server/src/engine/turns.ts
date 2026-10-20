import type { GameState, Monster } from "@dm/shared";
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

/**
 * For DmSession's stall check after a speech-only reply: the DM-played turn that is still open
 * (`key` changes with every turn), or undefined when a player character acts or there is no combat.
 */
export function stalledTurn(state: GameState): { key: string; prompt: string } | undefined {
  // Every foe is down but the initiative strip is still up: the DM said "the fight is over" without end_combat.
  // Not while a PC is dying (death saves need the turns) or before any foe was there to beat.
  const foes = state.monsters.filter((x) => !x.ally && !x.neutral);
  const dying = state.characters.some((c) => c.hp <= 0 && !c.deathSaves.stable && !c.conditions.some((x) => x.toLowerCase() === "dead"));
  if (state.combat.active && foes.length && !foes.some((x) => x.hp > 0) && !dying)
    return {
      key: `end:${state.combat.order.map((o) => o.entityId).join(",")}`,
      prompt: "[Combat: no foe is left standing. If the fight is over, call end_combat now (the initiative strip is still on the TV); otherwise continue the turn.]",
    };
  const m = dmCreatureTurn(state);
  if (!m) return undefined;
  return {
    key: `${state.combat.round}:${state.combat.turnIndex}:${m.id}`,
    prompt: `[Combat: it is still ${m.name}'s turn and you stopped. If its turn is already over, call next_turn now. Otherwise: ${dmTurnInstruction(m)} Don't repeat what you just said.]`,
  };
}
