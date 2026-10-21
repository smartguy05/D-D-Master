import { cellKey, findPath, reachableCells, type GameState } from "@dm/shared";
import { blockedCells, isCellBlocked, isCellFree, nearestFreeCell, tokenFor } from "./state.js";
import { currentGrid, type EngineContext } from "./tools.js";

type Cell = { x: number; y: number };

/** Where a move_token call ends up, worked out once for both the turn-economy gate and the handler. */
export interface MovePlan {
  /** The token stands on the board: a walk (a new token is just placed). */
  onBoard: boolean;
  from?: Cell;
  to: Cell;
  /** Squares walked (5 ft each); the straight-line distance for a placement or a terrain-free move. */
  squares: number;
  /** The route bent around walls or furniture. */
  around?: boolean;
  /** Walls and furniture were ignored (the host, or the DM's ignore_terrain). */
  free: boolean;
  /** Why `to` differs from the requested cell. */
  redirect?: "occupied" | "furniture" | "no_route";
  /** Name of the furniture covering the requested cell. */
  blocker?: string;
  /** Nothing reachable is closer than where the token stands: it doesn't move. */
  stuck?: boolean;
}

const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Plan a move. The DM's token walks around walls, closed doors, windows and furniture (shortest
 * route, 5e diagonals one square). An occupied or furnished destination becomes the nearest free
 * reachable cell; an unreachable one becomes the reachable cell closest to it. The host, and the DM
 * with `ignoreTerrain` (a jump, a climb, a map that is wrong), place it straight there; only another
 * token still redirects them.
 */
export function planMove(state: GameState, ctx: Pick<EngineContext, "locations" | "source">, entityId: string, ax: number, ay: number, ignoreTerrain = false): MovePlan {
  const { gridW, gridH, features, walls } = currentGrid(state, ctx);
  const want = { x: Math.max(0, Math.min(gridW - 1, ax)), y: Math.max(0, Math.min(gridH - 1, ay)) };
  const t = tokenFor(state, entityId);
  const onBoard = !!t && t.x >= 0 && t.y >= 0;
  const from = onBoard ? { x: t!.x, y: t!.y } : undefined;
  const others = { ...state, tokens: state.tokens.filter((o) => o !== t) };
  const occupied = !isCellFree(others, want.x, want.y);
  const free = ctx.source === "host" || ignoreTerrain || !from;

  if (free) {
    const to = occupied ? nearestFreeCell(others, want.x, want.y, gridW, gridH, features) : want;
    return { onBoard, from, to, squares: from ? chebyshev(from, to) : 0, free: true, redirect: occupied ? "occupied" : undefined };
  }

  const blocked = blockedCells(features, gridW, gridH);
  const grid = { gridW, gridH, walls, blocked };
  const reach = reachableCells(from, grid);
  const blocker = features.find((f) => f.blocks && isCellBlocked([f], want.x, want.y));
  let to: Cell = want;
  let redirect: MovePlan["redirect"];
  if (occupied || blocker) {
    to = nearestFreeCell(others, want.x, want.y, gridW, gridH, features, (cx, cy) => reach.has(cellKey(cx, cy)));
    redirect = occupied ? "occupied" : "furniture";
  }
  if (!reach.has(cellKey(to.x, to.y))) {
    // No route: the free reachable cell closest to the goal (fewest squares walked on a tie).
    let best: Cell = from;
    let bestD = chebyshev(from, want);
    let bestWalk = 0;
    for (const [k, walked] of reach) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      if (!isCellFree(others, x, y)) continue;
      const d = chebyshev({ x, y }, want);
      if (d < bestD || (d === bestD && walked < bestWalk)) [best, bestD, bestWalk] = [{ x, y }, d, walked];
    }
    to = best;
    redirect = "no_route";
  }
  const route = findPath(from, to, grid);
  const squares = route?.squares ?? 0;
  const stuck = redirect === "no_route" && to.x === from.x && to.y === from.y;
  return { onBoard, from, to, squares, around: squares > chebyshev(from, to) || undefined, free: false, redirect, blocker: blocker?.name, stuck };
}
