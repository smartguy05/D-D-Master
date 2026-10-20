# Bug: Dead token tipped over from state while the dice were still rolling
Status: fixed (2026-10-20)
Area: web / table

## Overview
`TokenView.fallen` came straight from the state, which arrives before the roll/effect/moment. The
token eased down within ~1 s while its death moment was still held behind the dice tray, so the
moment's tip-over never played (`Math.max(mp.tilt, tilt.current)` kept it flat) and the killing
blow hit a token already on the ground.

## Repro
A player's attack kills a goblin: during the d20 + damage dice animation the goblin standee lies
down and greys; when the dice finish only the mist appears.

## Root cause / Fix
`momentPlan.heldStanding(held)` lists the targets of held death/monster_death moments; TablePage
keeps them in `standing` state (synced in `flushMoments`) and passes it to MapBoard, where
`tokenFallen(stateFallen, id, standing)` keeps those tokens upright until the moment plays.
Tests: momentPlan.test.ts "tokens stay standing while their death moment is held".

## Notes
A held `revived` moment is not covered (the token rises from state early); minor.

## TODOs

## Completed
- 2026-10-20: Fixed with regression tests.
