# Bug: No death save when a downed PC had the first turn of combat
Status: fixed (2026-10-18)
Area: server (engine/rules)

## Overview
MEDIUM. Death saves were only made in `next_turn`, so a downed PC first in initiative skipped its round-1 save.

## Repro
`start_combat` with a PC at 0 HP who wins initiative → no save.

## Root cause / Fix
`start_combat` runs `rollDeathSave` for `order[0]` when that PC needs one. Test: vitals.test.ts "start_combat rolls the death save…".

## Notes
Found by the A2 adversarial review, round 1.

## TODOs

## Completed
- 2026-10-18: Fixed with tests (stream A2 review round 1).
