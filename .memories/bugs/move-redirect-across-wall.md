# Bug: move_token refused a legal move when the redirect cell was across a wall
Status: fixed (2026-10-20)
Area: server (engine/tools.ts move_token, engine/state.ts nearestFreeCell)

## Overview
An occupied (or furniture-blocked) destination is redirected to `nearestFreeCell`, which knew
nothing about walls. When that cell lay across a wall, the second wall check refused the whole
move, although near-side cells were free.

## Repro
Wall x=4; Thorin (1,2), Lyra (3,0), goblin (2,0); `move_token Thorin → (3,0)` → wall error
(redirect picked (4,0)). (Found by the Phase 1 adversarial review.)

## Root cause / Fix
`nearestFreeCell` takes an optional `reachable(x, y)` filter it prefers; `move_token` passes "not
through a wall from where the mover stands". Without a reachable cell it falls back as before.

## Notes
- Test: `apps/server/src/engine/board.test.ts` ("move_token redirect respects walls").

## TODOs

## Completed
- 2026-10-20: Fixed.
