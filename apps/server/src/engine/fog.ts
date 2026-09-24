import { activeFog, cellsInRadius, lightRadiusOf, type GameState, type LocationFog } from "@dm/shared";

/** Fog entry for the current location, created (disabled) if missing. Mutates `state`. */
export function fogEntry(state: GameState): LocationFog | undefined {
  if (!state.locationId) return undefined;
  state.fog ??= {};
  state.fog[state.locationId] ??= { enabled: false, revealed: [] };
  return state.fog[state.locationId];
}

/** Add cells to the current location's revealed set. Returns how many were new. Mutates `state`. */
export function revealCells(state: GameState, cells: string[]): number {
  const f = fogEntry(state);
  if (!f) return 0;
  const set = new Set(f.revealed);
  const before = set.size;
  for (const c of cells) set.add(c);
  if (set.size !== before) f.revealed = [...set];
  return set.size - before;
}

/**
 * Reveal everything the party can see: a circle of each character's light radius around their
 * token. No-op when fog is off for the current location. Mutates `state`.
 * There is no wall data yet, so light is not blocked (see docs/web/table-display.md).
 */
export function revealAroundCharacters(state: GameState, grid: { gridW: number; gridH: number }): number {
  if (!activeFog(state)) return 0;
  const cells: string[] = [];
  for (const c of state.characters) {
    const t = state.tokens.find((x) => x.entityId === c.id);
    if (!t || t.x < 0 || t.y < 0) continue;
    cells.push(...cellsInRadius(t.x, t.y, lightRadiusOf(c), grid.gridW, grid.gridH));
  }
  return revealCells(state, cells);
}
