# Bug: A door added on top of a wall run never opened (the wall under it still blocked)
Status: fixed (2026-10-20)
Area: server (engine/board.ts editWalls), web (host/board/geometry.ts hitSegment)

## Overview
`edit_walls add` of a door or window pushed the new segment and left the wall underneath, so after
`set_door open` the wall still blocked line of sight, cover, fog and movement. In the host editor,
`hitSegment` kept the first segment at equal distance, so a click on the doorway picked the wall.

## Repro
Walls `[w1 x=4 y0..10]`; host `edit_walls add {4,2 → 4,3 door}`; `set_door d open:true`;
`hasLineOfSight((3,2),(4,2))` stays false. (Found by the Phase 1 adversarial review.)

## Root cause / Fix
- `editWalls` add: `cutUnder` removes the stretch under a new door (walls and windows) or window
  (walls) from segments on the same grid line, like `wallsFromLines` does; the first piece keeps
  the wall's id, a second piece gets a fresh one. A wall added over a door leaves the door alone.
- `hitSegment`: on a tie a door/window wins over a plain wall.

## Notes
- Tests: `apps/server/src/engine/board.test.ts` ("edit_walls add of a door or window over a wall
  run"), `apps/web/src/host/board/geometry.test.ts` ("hitSegment prefers a door").

## TODOs

## Completed
- 2026-10-20: Fixed (cut walls under doors/windows; door wins hit ties).
