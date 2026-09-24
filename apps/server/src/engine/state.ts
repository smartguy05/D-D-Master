import type { Character, GameState, LogEntry, Monster, RollResult, Token } from "@dm/shared";
import { newId } from "./ids.js";

export const MAX_LOG = 300;
export const MAX_ROLLS = 30;

export type Combatant = { kind: "character"; entity: Character } | { kind: "monster"; entity: Monster };

/** Find a character or monster by id, or fall back to a case-insensitive name match. */
export function findCombatant(state: GameState, idOrName: string): Combatant | undefined {
  const key = idOrName.trim();
  const c = state.characters.find((x) => x.id === key);
  if (c) return { kind: "character", entity: c };
  const m = state.monsters.find((x) => x.id === key);
  if (m) return { kind: "monster", entity: m };
  const lower = key.toLowerCase();
  const cn = state.characters.find(
    (x) => x.name.toLowerCase() === lower || x.playerName.toLowerCase() === lower,
  );
  if (cn) return { kind: "character", entity: cn };
  const mn = state.monsters.find((x) => x.name.toLowerCase() === lower);
  if (mn) return { kind: "monster", entity: mn };
  const partial = state.characters.find((x) => x.name.toLowerCase().startsWith(lower));
  if (partial) return { kind: "character", entity: partial };
  const mpartial = state.monsters.find((x) => x.name.toLowerCase().startsWith(lower));
  if (mpartial) return { kind: "monster", entity: mpartial };
  return undefined;
}

export function requireCombatant(state: GameState, idOrName: string): Combatant {
  const c = findCombatant(state, idOrName);
  if (!c) throw new Error(`No character or monster matches "${idOrName}". Call get_party_status for ids.`);
  return c;
}

export function requireCharacter(state: GameState, idOrName: string): Character {
  const c = findCombatant(state, idOrName);
  if (!c || c.kind !== "character") throw new Error(`No player character matches "${idOrName}".`);
  return c.entity;
}

export function addLog(state: GameState, entry: Omit<LogEntry, "id" | "ts">): LogEntry {
  const full: LogEntry = { id: newId("log"), ts: Date.now(), ...entry };
  state.log.push(full);
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  return full;
}

export function addRoll(state: GameState, roll: RollResult): void {
  state.rolls.push(roll);
  if (state.rolls.length > MAX_ROLLS) state.rolls.splice(0, state.rolls.length - MAX_ROLLS);
}

export function tokenFor(state: GameState, entityId: string): Token | undefined {
  return state.tokens.find((t) => t.entityId === entityId);
}

export function isCellFree(state: GameState, x: number, y: number, ignoreEntity?: string): boolean {
  return !state.tokens.some((t) => t.entityId !== ignoreEntity && t.x === x && t.y === y);
}

/** Spiral outward from (x, y) to find the nearest free in-bounds cell. */
export function nearestFreeCell(
  state: GameState,
  x: number,
  y: number,
  gridW: number,
  gridH: number,
): { x: number; y: number } {
  const clampX = (v: number) => Math.max(0, Math.min(gridW - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(gridH - 1, v));
  const sx = clampX(x);
  const sy = clampY(y);
  for (let r = 0; r < Math.max(gridW, gridH); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = sx + dx;
        const cy = sy + dy;
        if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) continue;
        if (isCellFree(state, cx, cy)) return { x: cx, y: cy };
      }
    }
  }
  return { x: sx, y: sy };
}
