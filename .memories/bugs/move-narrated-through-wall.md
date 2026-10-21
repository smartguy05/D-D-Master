# Bug: DM narrated moves the engine refused; tokens stuck behind map walls
Status: fixed (2026-10-21)
Area: server (engine/movement.ts, engine/tools.ts move_token, engine/economy.ts gateMove, shared los.ts, realtime/instructions.ts)

## Overview
In the Old Mill (Hollowberry Hollow, `cmp_04ee010393`) the DM made ~15 `move_token` calls to walk
Brannoc toward the rug. Every one returned the straight-line wall error and the token never moved,
yet the DM narrated "you've managed to move along the northern route", made up a "timber support"
as the blocker, and kept asking "left or right?". The player could not get further into the room.

## Repro
Mill walls as read from the painted map: the west wall `w12` runs x=4, y 3–13. The host dropped
Brannoc at (1,10), inside the pocket west of it (exit only along row 13). `move_token` → (5,10),
(4,9), (10,8), (11,10)… every straight line crossed `w12` and was refused.

## Root cause / Fix
- `move_token` accepted only a straight line ("move around in steps"), but the DM never sees wall
  positions (only doors), so it could not plan the steps. Now `planMove` (engine/movement.ts) walks
  the shortest route with `findPath` (los.ts: 8-neighbour BFS, `moveBlocked` per step, `blocks`
  features impassable). An unreachable target stops at the reachable cell closest to it
  (`redirected`, reason "no open route"). The only error left is "did not move and is still at
  (x, y)".
- In combat `gateMove` charges the route's squares (the same `planMove`), not the Chebyshev line.
- The DM is the final rules authority (user request): `ignore_terrain: true` places the token
  straight there past walls and onto furniture (a jump, a climb, a wrong map); combat still counts
  the straight squares unless `override`.
- The persona says to narrate only the result, and that an error means no move. CURRENT LOCATION
  names the detected entrance instead of a hard-coded "enters from the left edge" (the mill's
  entrance is the east doorway).

## Notes
- Tests: `packages/shared/src/los.test.ts` (findPath incl. the mill walls),
  `apps/server/src/engine/tools.test.ts` ("move_token and walls (M1)"),
  `economy.test.ts` (routed cost), `service.board.test.ts` (ignore_terrain onto pews),
  `realtime/instructions.test.ts`.
- Related: [move-redirect-across-wall](move-redirect-across-wall.md).
- Not fixed here: the map reader sealing the mill's west side with one long wall (wall-detection
  quality). The host can fix walls in the editor.

## TODOs
- [ ] Consider improving wall detection so the "open entrance" in a map prompt isn't traced shut.

## Completed
- 2026-10-21: Fixed (routing, ignore_terrain, routed combat cost, persona and entrance line).
