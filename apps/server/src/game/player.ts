import type { Character, GameState, Player } from "@dm/shared";

/**
 * Player phone view (/player/:playerId): pure checks used by GameService and routes/player.ts.
 * Phones are read-mostly. They can roll virtual dice, answer their own physical roll prompt and
 * switch their own dice mode. HP, inventory and everything else stay with the host and the DM.
 */

/** Roll totals a phone may submit (guards against typos like 1700). */
export const MIN_TOTAL = -20;
export const MAX_TOTAL = 200;

export function playerCharacter(state: GameState, playerId: string): { player: Player; character: Character } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("Unknown player.");
  const character = state.characters.find((c) => c.id === player.characterId);
  if (!character) throw new Error(`${player.name} has no character yet.`);
  return { player, character };
}

export function parseTotal(raw: unknown): number {
  const total = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof total !== "number" || !Number.isInteger(total) || total < MIN_TOTAL || total > MAX_TOTAL) {
    throw new Error(`Roll total must be a whole number between ${MIN_TOTAL} and ${MAX_TOTAL}.`);
  }
  return total;
}

/**
 * Decide which character a physical roll total belongs to.
 * - From a phone (playerId): only that player's character, and only while the pending roll is theirs.
 * - From the host (characterId, optional): defaults to the pending roll's character; a different
 *   character is refused so it cannot clear someone else's pending prompt with the wrong label.
 */
export function authorizePhysicalRoll(state: GameState, from: { playerId?: string; characterId?: string }): string {
  const pending = state.pendingRoll;
  if (from.playerId) {
    const { character } = playerCharacter(state, from.playerId);
    if (!pending || pending.characterId !== character.id) throw new Error(`No roll is waiting for ${character.name}.`);
    return character.id;
  }
  if (!pending) {
    if (from.characterId) return from.characterId;
    throw new Error("No physical roll is pending.");
  }
  if (from.characterId && from.characterId !== pending.characterId) {
    const who = state.characters.find((c) => c.id === pending.characterId)?.name ?? pending.characterId;
    throw new Error(`The pending roll is for ${who}. Use record_physical_roll for other characters.`);
  }
  return pending.characterId;
}

/** Validate a phone roll request. Physical-dice players use the number pad instead. */
export function checkPlayerRoll(state: GameState, playerId: string, notation: string, label: string) {
  const { player, character } = playerCharacter(state, playerId);
  if (character.diceMode === "physical") throw new Error(`${character.name} uses physical dice. Switch to virtual dice to roll here.`);
  const n = notation.trim();
  if (!n || n.length > 40) throw new Error("Enter dice notation such as 1d20+3.");
  return { player, character, notation: n, label: label.trim().slice(0, 60) };
}
