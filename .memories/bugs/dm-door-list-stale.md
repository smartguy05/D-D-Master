# Bug: The DM's door list went stale after set_door or edit_walls
Status: fixed (2026-10-20)
Area: server (game/service.ts runTool)

## Overview
`buildInstructions` lists the current location's doors with ids and open/closed state, but
`runTool` only refreshed the realtime instructions after `edit_map_feature` and scene changes. After
`set_door` the DM still saw "(closed)"; a door the host added never showed up with its id.

## Repro
`set_door d1 open:true` (or host `edit_walls add` a door) → the live DM's instructions still show
the old door list. (Found by the Phase 1 adversarial review.)

## Root cause / Fix
`runTool` calls `dm.refreshInstructions()` after `set_door` and `edit_walls` when the state changed.

## Notes
- Test: `apps/server/src/game/service.board.test.ts` ("refreshes the DM's instructions (its door
  list) after set_door and edit_walls").

## TODOs

## Completed
- 2026-10-20: Fixed.
