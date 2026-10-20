# Bug: Saving the outline let the client overwrite (or keep stale) server-owned Location.walls
Status: fixed (2026-10-20)
Area: server (game/outline.ts mergeOutline)

## Overview
`mergeOutline` treated `mapUrl` and `features` as server-owned but not `walls`, so the Outline
editor's stale draft (`walls: []`) wiped walls read meanwhile, a changed `mapPrompt` kept the old
picture's walls, and a crafted PUT could inject walls.

## Repro
Open the Outline editor during a map read → read stores walls → Save → walls gone.
(Found by the Phase 1 adversarial review.)

## Root cause / Fix
`mergeOutline` takes `walls` from the saved location when its `mapPrompt` is unchanged, else `[]`;
the client's value is ignored (new locations start with `[]`).

## Notes
- Test: `apps/server/src/game/outline.test.ts` ("walls are server-owned like features").

## TODOs

## Completed
- 2026-10-20: Fixed.
