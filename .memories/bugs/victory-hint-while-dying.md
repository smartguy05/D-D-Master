# Bug: victory_hint told the DM to end combat while a PC was dying
Status: fixed (2026-10-20)
Area: engine / moments

## Overview
Death saves only roll automatically at turn start, so ending combat stops a dying PC's saves.
`stalledTurn` already held its end_combat nudge back while a PC was dying, but the new
`victory_hint` ("then call end_combat with outcome victory") did not.

## Repro
Mara at 0 HP, Unconscious, not Stable; Bob kills the last goblin with `apply_damage`. The output
carried the plain victory_hint; the DM calls `end_combat` and Mara never rolls another save.

## Root cause / Fix
`victoryHint(state)` (moments.ts): with `dyingCharacters(state)` non-empty (0 HP, not Stable, not
Dead; shared with `stalledTurn`) the hint names them and says to keep the turns going until they
are healed or stabilised, then end the fight. The victory banner still plays.
Tests: moments.test.ts "victory while a PC is dying".

## Notes

## TODOs

## Completed
- 2026-10-20: Fixed with regression tests.
