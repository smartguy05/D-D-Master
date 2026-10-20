import { cellKey, cellsInRect, type Character, type GameState, type Item, type LogEntry, type MapFeature, type Monster, type RollResult, type Token } from "@dm/shared";
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

/**
 * Put items into a character's inventory (give_item, pick_up): a case-insensitive name match adds
 * to that stack (and gives it the icon when it has none), anything else becomes a new entry.
 */
/** Item names match ignoring case and surrounding spaces ("Dagger " is "dagger"). */
export function sameItemName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function addToInventory(c: Character, item: { name: string; qty: number; description?: string; iconUrl?: string }): Item {
  const existing = c.inventory.find((i) => sameItemName(i.name, item.name));
  if (existing) {
    existing.qty += item.qty;
    if (!existing.iconUrl && item.iconUrl) existing.iconUrl = item.iconUrl;
    return existing;
  }
  const added: Item = { id: newId("item"), name: item.name.trim(), qty: item.qty, description: item.description };
  if (item.iconUrl) added.iconUrl = item.iconUrl;
  c.inventory.push(added);
  return added;
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

/** Cells covered by `blocks` features (furniture, pillars, walls), as "x,y" keys clipped to the grid. */
export function blockedCells(features: readonly MapFeature[] | undefined, gridW: number, gridH: number): Set<string> {
  const out = new Set<string>();
  for (const f of features ?? []) if (f.blocks) for (const k of cellsInRect(f.x, f.y, f.w, f.h, gridW, gridH)) out.add(k);
  return out;
}

/**
 * Spiral outward from (x, y) to find the nearest free in-bounds cell that no `blocks` feature
 * covers. The start cell itself counts, so a blocked or occupied start moves to the nearest good
 * cell. If every free cell is blocked it settles for a free blocked cell, and on a completely full
 * board it returns the (clamped) start. It never throws or loops forever.
 */
export function nearestFreeCell(
  state: GameState,
  x: number,
  y: number,
  gridW: number,
  gridH: number,
  features: readonly MapFeature[] = [],
  /** Extra test a cell should pass (e.g. reachable without crossing a wall); preferred, not required. */
  reachable?: (x: number, y: number) => boolean,
): { x: number; y: number } {
  const clampX = (v: number) => Math.max(0, Math.min(gridW - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(gridH - 1, v));
  const sx = clampX(x);
  const sy = clampY(y);
  const blocked = blockedCells(features, gridW, gridH);
  const spiral = (ok: (cx: number, cy: number) => boolean) => {
    for (let r = 0; r < Math.max(gridW, gridH); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = sx + dx;
          const cy = sy + dy;
          if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) continue;
          if (ok(cx, cy)) return { x: cx, y: cy };
        }
      }
    }
    return undefined;
  };
  const preferred = reachable
    ? spiral((cx, cy) => isCellFree(state, cx, cy) && !blocked.has(cellKey(cx, cy)) && reachable(cx, cy)) ??
      spiral((cx, cy) => isCellFree(state, cx, cy) && reachable(cx, cy))
    : undefined;
  return (
    preferred ??
    spiral((cx, cy) => isCellFree(state, cx, cy) && !blocked.has(cellKey(cx, cy))) ??
    spiral((cx, cy) => isCellFree(state, cx, cy)) ?? { x: sx, y: sy }
  );
}

/** Is (x, y) covered by a `blocks` feature? */
export function isCellBlocked(features: readonly MapFeature[] | undefined, x: number, y: number): boolean {
  return (features ?? []).some((f) => f.blocks && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
}
