# Bug: One DM set_door locked the location's wall set against later repaints
Status: fixed (2026-10-20)
Area: shared (schemas.ts WallEdit), server (engine/tools.ts set_door, resetForRepaint), web (BoardTab)

## Overview
`set_door` stores door state by copying all walls into `state.wallEdits[loc]`, and wall edits
survive a repaint (meant for host fixes). After one DM door toggle, a repaint kept the old
picture's walls and door ids, and the host board said "edited by host".

## Repro
`set_door d1 open:true` → force repaint with different walls → `effectiveWalls` still returns the
old segments. (Found by the Phase 1 adversarial review.)

## Root cause / Fix
`WallEdit.host` (default true, so old saves keep their edits): `set_door` keeps the existing flag or
writes `host: false`; `edit_walls` writes `host: true`. `resetForRepaint` drops a `host: false`
edit. BoardTab shows "edited by host" only for host edits.

## Notes
- Test: `apps/server/src/engine/board.test.ts` ("a DM door toggle does not pin the walls").

## TODOs

## Completed
- 2026-10-20: Fixed.
