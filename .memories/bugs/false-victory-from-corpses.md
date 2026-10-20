# Bug: Old corpses and a repeated end_combat show a false victory banner
Status: fixed (2026-10-20)
Area: engine / moments

## Overview
`foesBeaten` counted every non-ally, non-neutral monster in `state.monsters`, dead ones included,
and `end_combat` never checked `combat.active`. Corpses stay in the scene until `change_scene`, so
after a won fight the scene looked "won" forever.

## Repro
1. Kill the goblins (victory auto-announced), call `end_combat`.
2. Call `end_combat` again: a second `victory` moment and "Combat ends (victory)." in the log.
3. Or, in the same scene, `start_combat` with no living foe (a chase), then `roll_dice`: "Every
   foe is down" + `victory_hint` before any new enemy exists.

## Root cause / Fix
- `end_combat` returns `{ok, note: "No combat is running."}` with no moment, log or state change
  when `!combat.active`.
- New `combatFoes(state)` (turns.ts): `foesOf` minus corpses that are not in the initiative order;
  a living foe always counts (reinforcements spawned mid-fight are not in the order). Out of combat
  it is empty. `foesBeaten` and `stalledTurn` use it.
- Tests: moments.test.ts "old corpses and out-of-combat end_combat".

## Notes
Limitation: a combat whose only foes were spawned after `start_combat` (spawn_monster does not join
initiative) gets no auto-victory once they die; the DM still ends it with `end_combat`.

## TODOs

## Completed
- 2026-10-20: Fixed with regression tests.
