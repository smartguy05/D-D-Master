# Bug: A door narrower than a grid cell vanished and its doorway became a solid wall
Status: fixed (2026-10-20)
Area: shared (features.ts wallsFromLines)

## Overview
`wallsFromLines` snaps every point to the nearest grid intersection and drops zero-length legs. A
doorway under about one cell wide snapped both door ends to the same point, so the door was
dropped, and the walls on either side met: the doorway was sealed with no door id.

## Repro
gridW 24: wall 0.1→0.40, door 0.40→0.43, wall 0.43→0.8 on one row → only one continuous wall.
(Found by the Phase 1 adversarial review.)

## Root cause / Fix
A door line that collapses to a point becomes the one unit grid edge under its midpoint, along its
longer direction (`unitDoor`); the door then cuts the wall under it as usual.

## Notes
- Test: `packages/shared/src/features.test.ts` ("a door narrower than a cell is kept").

## TODOs

## Completed
- 2026-10-20: Fixed.
