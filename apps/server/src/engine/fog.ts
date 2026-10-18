import { activeFog, cellsInRadius, lightRadiusOf, litFeatureCells, type GameState, type LocationFog, type MapFeature } from "@dm/shared";

/** Fog entry for the current location, created (disabled) if missing. Mutates `state`. */
export function fogEntry(state: GameState): LocationFog | undefined {
  if (!state.locationId) return undefined;
  state.fog ??= {};
  state.fog[state.locationId] ??= { enabled: false, revealed: [], hidden: [] };
  const f = state.fog[state.locationId];
  f.hidden ??= []; // entries written before `hidden` existed
  return f;
}

/**
 * Add cells to the current location's revealed set. Returns how many were new. Mutates `state`.
 * Cells the host hid are skipped, unless `explicit` (reveal_area, edit_fog reveal): then they
 * are un-hidden and revealed.
 */
export function revealCells(state: GameState, cells: string[], opts: { explicit?: boolean } = {}): number {
  const f = fogEntry(state);
  if (!f) return 0;
  const hidden = new Set(f.hidden);
  if (opts.explicit && hidden.size) {
    const n = hidden.size;
    for (const c of cells) hidden.delete(c);
    if (hidden.size !== n) f.hidden = [...hidden];
  }
  const set = new Set(f.revealed);
  const before = set.size;
  for (const c of cells) if (opts.explicit || !hidden.has(c)) set.add(c);
  if (set.size !== before) f.revealed = [...set];
  return set.size - before;
}

/** Shroud cells and keep them shrouded against auto-reveal. Returns how many were newly hidden. Mutates `state`. */
export function hideCells(state: GameState, cells: string[]): number {
  const f = fogEntry(state);
  if (!f) return 0;
  const drop = new Set(cells);
  f.revealed = f.revealed.filter((c) => !drop.has(c));
  const hidden = new Set(f.hidden);
  const before = hidden.size;
  for (const c of cells) hidden.add(c);
  f.hidden = [...hidden];
  return hidden.size - before;
}

/**
 * Reveal everything the party can see: a circle of each character's light radius around their
 * token, plus the glow around the map's lit features. No-op when fog is off for the current
 * location. Mutates `state`.
 * There is no wall data yet, so light is not blocked (see docs/web/table-display.md).
 */
export function revealAroundCharacters(state: GameState, grid: { gridW: number; gridH: number; features?: MapFeature[] }): number {
  if (!activeFog(state)) return 0;
  const cells: string[] = litFeatureCells({ ...grid, features: grid.features ?? [] });
  for (const c of state.characters) {
    const t = state.tokens.find((x) => x.entityId === c.id);
    if (!t || t.x < 0 || t.y < 0) continue;
    cells.push(...cellsInRadius(t.x, t.y, lightRadiusOf(c), grid.gridW, grid.gridH));
  }
  return revealCells(state, cells);
}
