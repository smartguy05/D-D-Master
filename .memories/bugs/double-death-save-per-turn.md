# Bug: a dying PC can make two death saves in one turn
Status: fixed (2026-10-20)
Area: server (rules engine)

## Overview
At the start of a dying character's turn the engine rolls the death save automatically. The DM can
then call `death_save` for the same character on the same turn and it rolls again.

## Repro
Test run 2026-10-19: Brienne at 0 HP. Turn start: automatic save (2, failure). Same turn, the DM
called `death_save` (event 606): 14, success. Result 1 success / 1 failure from one turn.

## Root cause / Fix
`rollDeathSave` (`engine/rules/vitals.ts`) has no once-per-turn guard. Fix: remember the round/turn
of the last save (e.g. `deathSaves.lastTurn`) and refuse a second one in the same turn with a
clear error ("already rolled this turn: failure").

## TODOs
## Completed
- [x] 2026-10-20: Guard + test
- 2026-10-20: DeathSaves.lastRolled {round, entityId}: a second death save in the same combat turn returns an error; start/end_combat clear it. Tests: vitals.test.ts, combat-edge-cases.test.ts.
