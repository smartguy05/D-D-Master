import { DEFAULT_LIGHT_RADIUS, type Character, type GameState, type LocationFog } from "./schemas.js";

/**
 * Fog-of-war helpers shared by the server engine and the table display.
 * Cells are stored as "x,y" strings. There is no wall data yet, so "line of sight" is a plain
 * radius: light passes through everything.
 */

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseCellKey(key: string): { x: number; y: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** Cells within `radius` of (cx, cy), clipped to the grid. Round shape: dx²+dy² ≤ r² + r. */
export function cellsInRadius(cx: number, cy: number, radius: number, gridW: number, gridH: number): string[] {
  const r = Math.max(0, Math.floor(radius));
  const lim = r * r + r;
  const out: string[] = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(gridH - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(gridW - 1, cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= lim) out.push(cellKey(x, y));
    }
  }
  return out;
}

/** Cells in the rectangle with top-left (x, y) and size w × h, clipped to the grid. */
export function cellsInRect(x: number, y: number, w: number, h: number, gridW: number, gridH: number): string[] {
  const out: string[] = [];
  for (let cy = Math.max(0, y); cy < Math.min(gridH, y + h); cy++) {
    for (let cx = Math.max(0, x); cx < Math.min(gridW, x + w); cx++) out.push(cellKey(cx, cy));
  }
  return out;
}

export function lightRadiusOf(c: Pick<Character, "lightRadius">): number {
  return c.lightRadius ?? DEFAULT_LIGHT_RADIUS;
}

/** Fog for the current location, or undefined when fog is off there. */
export function activeFog(state: Pick<GameState, "fog" | "locationId">): LocationFog | undefined {
  if (!state.locationId) return undefined;
  const f = state.fog?.[state.locationId];
  return f?.enabled ? f : undefined;
}

/** A predicate "can the party see cell (x, y)?" for the current location (always true without fog). */
export function visibilityOf(state: Pick<GameState, "fog" | "locationId">): (x: number, y: number) => boolean {
  const f = activeFog(state);
  if (!f) return () => true;
  const set = new Set(f.revealed);
  return (x, y) => set.has(cellKey(x, y));
}
