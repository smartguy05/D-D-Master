# Bug: the player projection still sent a visible monster's AC through attack rolls
Status: fixed (2026-10-22)
Area: shared (projection.ts)

## Overview
`publicMonster` set `ac` to 0, but the same AC reached player sockets elsewhere: `roll_dice` stores
the target's AC (plus cover) as `RollResult.dc` on every non-secret attack, `request_player_roll`
stores it as `pendingRoll.dc`, and the roll log line's cover note reads "vs AC 17". `publicRoll` only
stripped `dc` from secret rolls and `publicPending` only acted on hidden targets.

## Repro
Thorin `roll_dice {1d20+2, attack, target_id: goblin (AC 17)}` → `publicState(state).rolls.at(-1).dc
=== 17`; a physical `request_player_roll` at the goblin → `publicState(state).pendingRoll.dc === 17`.

## Root cause / Fix
The projection treated `dc` as harmless, assuming the phone showed it (no web code reads `.dc`).
`publicRoll` now drops `dc` from attack rolls (or any roll with a `targetId`) and keeps `success`;
`publicPending` drops `dc` when `targetId` is not a PC, in parked scenes too; `publicLogEntry`
removes ` vs AC N` from roll lines.

## Notes
- Tests: apps/server/src/engine/rolls.test.ts ("player projection of engine rolls"),
  packages/shared/src/projection.test.ts (publicRoll AC, log/parked pending).
- The TV (full state) still prints "vs AC N" for covered attacks; that is the shared room screen.

## TODOs

## Completed
- 2026-10-22: fixed with tests (online play phase 2 review).
