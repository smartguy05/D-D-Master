import { emptyGameState, type Character, type GameState } from "@dm/shared";

export interface ResetOptions {
  /** Keep the enrolled players (their voiceprints and notes live in the store, see GameService). */
  keepPlayers: boolean;
  /** Keep the character sheets, restored to fresh. */
  keepCharacters: boolean;
}

/**
 * "Start over": a fresh GameState for the same campaign. Board, combat, rolls, log, fog, feature
 * edits and location are always cleared. Kept characters come back fully restored, even when
 * downed or dead (unlike longRest), and keep their level, inventory and gold.
 */
export function resetState(state: GameState, opts: ResetOptions): GameState {
  const next = emptyGameState(state.campaignId);
  next.version = state.version + 1;
  if (opts.keepCharacters) next.characters = state.characters.map(freshCharacter);
  if (opts.keepPlayers) {
    next.players = state.players.map((p) => {
      const player = structuredClone(p);
      if (!opts.keepCharacters) delete player.characterId;
      return player;
    });
  }
  return next;
}

function freshCharacter(c: Character): Character {
  const fresh = structuredClone(c);
  fresh.hp = fresh.maxHp;
  fresh.tempHp = 0;
  fresh.conditions = [];
  fresh.concentration = null;
  fresh.deathSaves = { successes: 0, failures: 0, stable: false };
  fresh.hitDice.used = 0;
  for (const s of fresh.spellSlots) s.used = 0;
  if (fresh.pactSlots) fresh.pactSlots.used = 0;
  for (const r of fresh.resources) r.used = 0;
  delete fresh.slotTurn;
  return fresh;
}
