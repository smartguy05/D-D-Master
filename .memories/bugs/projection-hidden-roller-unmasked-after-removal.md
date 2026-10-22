# Bug: a hidden creature's past rolls were unmasked once it left the state
Status: fixed (2026-10-22)
Area: shared (projection.ts), server (engine/rolls.ts)

## Overview
The projection judged "hidden roller" against the current monsters only. After `remove_monster`,
`change_scene` (non-following monsters dropped) or removal on death, the creature's earlier rolls
and roll log lines went to players with its real name, label and id, including "X rolled Stealth:
(secret)".

## Repro
Hidden `m1` "Doppelganger Assassin" rolls `Stealth vs party`; `remove_monster m1`;
`publicState(state).rolls.at(-1).rollerName === "Doppelganger Assassin"` and its log line is back.

## Root cause / Fix
Visibility at the time of the roll was never recorded. `makeRoll` now tags the roll and its log line
`unseen: true` (new optional schema fields on RollResult and LogEntry) when the roller is in
`hiddenCreatureIds`; `publicRoll` and `publicLogEntry` honour the tag as well as the current-state check.

## Notes
- Tests: apps/server/src/engine/rolls.test.ts ("a hidden creature's rolls stay anonymous after it
  leaves the state", plus the visible-monster counterpart), projection.test.ts (unseen tag).
- Rolls saved before the tag existed fall back to the current-state check.

## TODOs

## Completed
- 2026-10-22: fixed with tests (online play phase 2 review).
