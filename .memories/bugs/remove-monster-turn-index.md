# Bug: remove_monster moved the current turn to another creature
Status: fixed (2026-10-18)
Area: server (engine)

## Overview
`remove_monster` filtered the initiative order but only reset `turnIndex` when it ran past the end.
Removing a creature listed before the current one silently gave the turn to the next creature,
which also confused the rules engine's one-slot-per-turn warning (it keys off round + turnIndex).

## Repro
Order Goblin, Lyra, Thorin; it is Thorin's turn (index 2). Remove the goblin: index 2 is now past
the end → reset to 0 → Lyra's turn.

## Root cause / Fix
`apps/server/src/engine/tools.ts` `remove_monster` finds the removed entry's index first and
decrements `turnIndex` when it was before the current turn. Removing the current creature leaves
the index on the next one (wrapping to 0). Test: `engine/tools.test.ts` "remove_monster keeps the
current turn…".

## Notes
Found during the A2 review, round 2 (pre-existing).

## TODOs

## Completed
- 2026-10-18: Fixed with a test.
