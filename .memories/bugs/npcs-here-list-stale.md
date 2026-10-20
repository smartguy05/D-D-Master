# Bug: the DM's "NPCs here" attitude list went stale
Status: fixed (2026-10-20)
Area: server (game service, realtime instructions)

## Overview
The instructions list every creature on the map with its attitude ("NPCs here") and the persona
tells the DM to treat it as current. `GameService.runTool` never refreshed the instructions after
`adjust_attitude`, `set_disposition`, `add_npc`, `spawn_monster` or `remove_monster`, so the list
showed old attitudes and missed creatures added mid-scene.

## Repro
Pell on the map at Friendly (+3); `adjust_attitude -2` twice (or the host Board -/+ buttons). The
live instructions still said Friendly (+3). A creature from `spawn_monster`/`add_npc` never appeared.

## Root cause / Fix
runTool refreshed only for map-object, feature, door and wall tools and scene changes. Fix:
`CREATURE_LIST_TOOLS` in `service.ts`; a changed call to any of them calls
`dm.refreshInstructions()`. Test: "the DM's 'NPCs here' list stays current" in
`apps/server/src/game/service.board.test.ts`.

## Notes
- Any new tool that changes what the instructions list must be added to a refresh set in runTool.

## TODOs

## Completed
- 2026-10-20: CREATURE_LIST_TOOLS refresh, with a test.
