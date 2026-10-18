# Bug: Level-up at 0 HP, pending-roll edge cases, slot-per-turn, ASI features
Status: fixed (2026-10-18)
Area: server (engine/rules)

## Overview
LOW/LOW-MED findings: level_up at 0 HP left the PC Unconscious with old saves (and levelled Dead PCs); a second concentration save replaced the first pending one; healing / ending concentration left moot pending rolls; recording a pending death save with kind=check discarded it; no warning for two slot spells in one turn; Mystic Arcanum above its level silently cast at its level; "Exhaustion: 2"/"(2)" not read; repeated features (ASI at 8) not reported because only the first level has a heading.

## Repro
See the tests named in the fix.

## Root cause / Fix
level_up refuses the dead and calls `regainedHp`; `requestPhysical` never overwrites (second save asked for afterwards); `regainedHp`/`endConcentration` clear the character's pending death/concentration roll; `record_physical_roll` applies kind=check as the pending kind with a warning; `Character.slotTurn` + SRD-quoted warning; arcanum warning; Exhaustion regex; level-up features from the table row via `findClassFeature`. Tests in vitals/level/cast/rests tests.

## Notes
Found by the A2 adversarial review, round 1.

## TODOs

## Completed
- 2026-10-18: Fixed with tests (stream A2 review round 1).
