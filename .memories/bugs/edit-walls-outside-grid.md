# Bug: edit_walls add clamped a segment wholly outside the grid onto the border
Status: fixed (2026-10-20)
Area: server (engine/board.ts editWalls)

## Overview
`add` only clamped coordinates, so a vertical segment at x=30 on a 12-wide grid became a wall
along the right border that the host never drew.

## Repro
12x10 grid: `edit_walls add {x1:30,y1:1,x2:30,y2:5,kind:"wall"}` → stored w at x=12, y 1..5.
(Found by the Phase 1 adversarial review.)

## Root cause / Fix
`add` refuses a segment whose grid line (x of a vertical, y of a horizontal) is off the board;
only its length is clamped (a span wholly outside still collapses and is refused).

## Notes
- Test: `apps/server/src/engine/board.test.ts` ("edit_walls add outside the grid").

## TODOs

## Completed
- 2026-10-20: Fixed.
