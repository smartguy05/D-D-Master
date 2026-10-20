# Bug: When a PC died, the next creature's turn never started
Status: fixed (2026-10-20)
Area: server / engine (turns, death saves)

## Overview
A downed PC makes their death save at the start of their own turn. When the save killed them (or
left them unconscious), the turn stayed on that PC. The DM narrated the death and then waited for a
player who could not act, so combat stalled until someone called `next_turn` by hand.

## Repro
Combat with a PC at 0 HP and 2 failures. `next_turn` lands on them, and the automatic save rolls
below 10, so they die. `combat.turnIndex` still points at the dead PC. The `next_turn` result has no
`instruction`, and `stalledTurn` only nudges for DM-played turns. With physical dice it is the same
after `record_physical_roll` kind `death_save`.

## Root cause / Fix
Nothing passed on a turn held by a PC who can't act. Fix:
- `passIncapableTurns` in `engine/tools.ts` (plus `incapableTurn` and `anyoneCanAct` in
  `engine/turns.ts`) runs after `beginTurn` in `next_turn`, `start_combat` and
  `leaveInitiativeAndBegin`, and in `record_physical_roll` for a death save on the PC's own turn.
- It skips Dead PCs and those still at 0 HP (no physical save pending), and starts the next turn.
- Results carry `passed`, plus an `instruction` to say so and continue.
- It stops when nobody in the order could act.
- `stalledTurn` nudges "call next_turn" when a PC is dropped on their own turn (a reaction).
- The one-save-per-turn guard (`rolledThisTurn` in `rules/vitals.ts`) now lasts until the PC's own
  turn comes round again, because the turn moves on right after the save.

Tests: `engine/rules/turn-pass.test.ts`. The vitals and combat-edge-cases tests were updated to the
new behaviour.

## Notes
Unconscious (not only Dead) PCs pass too: they can't act, and their turn is only the save. A
natural 20 wakes them, so they keep the turn.

## TODOs
- [ ] Live check with the voice DM: a PC dies on a failed save and the DM keeps going.

## Completed
- 2026-10-20: Fixed with regression tests.
