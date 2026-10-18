# Bug: heal brought Dead PCs back to life
Status: fixed (2026-10-18)
Area: server (engine/rules)

## Overview
MEDIUM (decision). `heal` removed the Dead condition, against SRD Dead: "can't regain them unless it is first revived by magic".

## Repro
`heal` a Dead PC → alive.

## Root cause / Fix
`heal` on a Dead PC returns `{error}` and changes nothing; new `revive {character_id, hp=1}` tool; `cast_spell` of Revivify/Raise Dead/Resurrection/True Resurrection at a dead target adds a hint. Persona mentions revive. Tests: vitals.test.ts, cast.test.ts.

## Notes
Found by the A2 adversarial review, round 1.

## TODOs

## Completed
- 2026-10-18: Fixed with tests (stream A2 review round 1).
