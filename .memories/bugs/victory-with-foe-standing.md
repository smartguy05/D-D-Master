# Bug: Victory banner while an enemy was still standing
Status: fixed (2026-10-20)
Area: engine / DM behaviour

## Overview
Two Awakened Shrubs; Bram killed Shrub 1 and the DM called `remove_monster` then
`end_combat {outcome:"victory"}`, narrating "the last snapping pumpkin is crushed", with Shrub 2
still at 9/10 HP. The engine had not auto-announced (correct), but an explicit DM outcome was
trusted blindly, so the TV played the victory banner and combat ended.

## Repro
Combat with two foes; drop one; DM calls `end_combat` with `outcome: "victory"`.

## Root cause / Fix
The DM model lost track of the second foe; `end_combat` accepted any explicit outcome.
- `end_combat`: a non-host `victory` while `foesStanding(state)` (living `combatFoes`) is non-empty
  returns `{error}` naming them; combat goes on. Host can force it; no outcome / `fled` still end.
- `dealDamage` (apply_damage, physical damage rolls): a foe dropped while others stand adds
  `foes_standing: ["Name (id, hp/max HP)"]` to the output.
- Persona line + TOOL_DESCRIPTIONS mention it. Tests: moments.test.ts "end_combat victory with a
  foe still standing".

## Notes
Found from the exported campaign event log (cmp_fc62fc3580, Halloween market fight).

## TODOs
- [ ] Live check that the DM reads `foes_standing` and keeps the fight going. (see general/live-test-checklist.md)

## Completed
- 2026-10-20: Fixed with regression tests.
