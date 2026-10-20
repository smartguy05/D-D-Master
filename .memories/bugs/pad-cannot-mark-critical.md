# Bug: phone and host pads can't mark a damage roll as critical
Status: fixed (2026-10-20)
Area: server (record_physical_roll damage) + web (phone pad, Play tab)

## Overview
A physical-dice player's damage total entered on the phone pad or the host's Play tab is always
applied with `critical: false`. Against a downed PC that is 1 death-save failure instead of the
SRD's 2, and the DM is told the roll is already recorded, so it can't be corrected.

## Repro
request_player_roll kind "damage" target=downed PC → phone pad enters 7 → 1 failure (expected 2
after a critical hit).

## Root cause / Fix
`submitPhysicalRoll` never passes `critical`, and the pads have no control for it. Fix:
`request_player_roll critical` (inferred from a natural 20 attack just before) stored on the pending
roll; a "💥 Critical hit" toggle on both pads, preset from it.

## TODOs
## Completed
- [x] 2026-10-20: pendingRoll.critical + inference; submitPhysicalRoll/routes pass critical; pad toggles
- 2026-10-20: pendingRoll.critical (request_player_roll critical, or inferred from a natural-20 attack at the same target: RollResult.attack/targetId); phone pad and Play tab Critical toggles; submitPhysicalRoll passes a boolean critical; virtual crits roll doubled dice. Tests: rolls.test.ts, service.host-note.test.ts. Live check 2026-10-20: inferred crit, pad preset, downed PC took 2 failures.
