# Bug: Fog revealed before the map's walls were read stayed revealed through them
Status: fixed (2026-10-20)
Area: server (game/service.ts stateAfterPaint, engine/tools.ts refogForWalls)

## Overview
A first paint kept the fog (`keepFog`), and `revealAroundCharacters` only adds cells. When the
party arrived before the map was painted and read, its light was revealed on a blank grid with
`walls: []`, so cells behind walls found later stayed explored and monsters there showed on the TV.

## Repro
Fog on, party placed, paint lands later with a closed wall at x=5 → cells x≥5 stay revealed.
(Found by the Phase 1 adversarial review.)

## Root cause / Fix
`refogForWalls`: on a first paint that read walls, the location's explored cells are dropped
(host-hidden cells stay) and the party's light is revealed again with the walls. Also applied to
the saved state when the campaign is not loaded.

## Notes
- Host reveals made on the blank grid before the first paint are dropped too (rare: no map yet).
- Test: `apps/server/src/game/service.board.test.ts` ("a first paint that reads walls drops fog").

## TODOs

## Completed
- 2026-10-20: Fixed.
