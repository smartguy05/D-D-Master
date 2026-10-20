# Bug: Hidden-fog spawns avoided cells the host had hidden inside a PC's light radius
Status: fixed (2026-10-20)
Area: server (engine/spawn.ts seenByParty)

## Overview
`seenByParty` counted every cell a PC has line of sight to within its light radius as seen, even
cells the host hid with `edit_fog hide`. Without walls, `fog: "hidden"` spawns moved out of the
light radius, unlike before walls existed.

## Repro
Fog on, 16x10, Thorin (light 4) at (1,5), every cell hidden →
`planSpawn(..., {anchor:(5,5), fog:"hidden"})` gave (6,5),(6,4),(6,6) instead of
(5,5),(4,5),(5,4). (Found by the Phase 1 adversarial review.)

## Root cause / Fix
Cells in `fog.hidden` never count as lit, so without walls the result equals the revealed cells
(the old behaviour).

## Notes
- Test: `apps/server/src/engine/spawn.test.ts` ("cells the host hid inside a PC's light radius").

## TODOs

## Completed
- 2026-10-20: Fixed.
