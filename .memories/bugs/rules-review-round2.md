# Bug: Rules engine review round 2 (class change resources, host HP edit, pending DC)
Status: fixed (2026-10-18)
Area: server (engine/rules, game/service)

## Overview
- MEDIUM: changing a character's class kept the old class's resources (derive kept every name the
  *new* class doesn't produce).
- MEDIUM: a host editor HP fix on a downed PC left them Unconscious with old death saves.
- LOW: `record_physical_roll kind=check` applied as the pending concentration save compared against
  the DM's passed `dc` instead of the pending DC.

## Repro
Fighter 5 → className Wizard: Second Wind stays. `updateCharacter(id, {hp: 10})` at 0 HP: still
Unconscious. Pending concentration DC 15, record kind=check total 12 dc 10: concentration kept.

## Root cause / Fix
- `ALL_CLASS_RESOURCE_NAMES` (rules-data.ts) = every class/subclass rule name; derive keeps only
  resources outside it.
- `GameService.updateCharacter` calls `regainedHp` when hp goes from ≤ 0 to > 0 for a non-Dead PC
  and the patch doesn't set conditions/deathSaves.
- `record_physical_roll` uses `pending.dc` when applying as the pending kind.
Tests in derive.test.ts, service.rules.test.ts, vitals.test.ts.

## Notes
Found by the A2 adversarial review, round 2.

## TODOs

## Completed
- 2026-10-18: Fixed with tests.
