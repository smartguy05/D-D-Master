# Bug: Turn marker moved on while the last attack's dice were still rolling
Status: fixed (2026-10-20)
Area: web / table

## Overview
On the TV the turn spotlight (ring, beam, light), initiative strip and Now card jumped to the next
creature while the previous attack's d20/damage dice were still animating. The turn banner was
already held behind the dice; the marker was not.

## Repro
Attack + damage roll, then the DM calls `next_turn` right away: the state (new `turnIndex`)
arrives during the dice animation and the spotlight moves at once.

## Root cause / Fix
MapBoard, the initiative strip, the party/foe lists and `nowPanelFor` read `combat.turnIndex`
straight from the state. Fix: pure `momentPlan.shownTurn(prev, stateTurn, {busy, now})` keeps the
previous turn while dice are busy, effects are held or moments are held (HOLD_CAP_MS cap; combat
end clears at once). TablePage syncs it on state change, on dice changes and in the 200 ms tick,
and passes `turnId` to MapBoard and `nowPanelFor`. Tests: momentPlan.test.ts "shownTurn",
nowPanel.test.ts "shows the turn the TV marks".

## Notes
Same family as attack-anim-before-damage-dice and token-falls-before-death-moment: anything the TV
derives from state that belongs after the dice must be held explicitly.

## TODOs
- [ ] Live check on the TV with the voice DM. (see general/live-test-checklist.md)

## Completed
- 2026-10-20: Fixed with regression tests.
