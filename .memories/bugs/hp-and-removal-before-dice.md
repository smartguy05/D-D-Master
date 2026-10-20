# Bug: Monster's HP dropped and it vanished before the damage dice finished
Status: fixed (2026-10-20)
Area: web / table

## Overview
Magic Missile: the DM called roll_dice + apply_damage three times, then remove_monster and
next_turn, all within about a second. The TV played the dice one after another (several seconds
each) but took HP and the token removal straight from the state, so the goblin's HP fell and it
disappeared while the first dart's dice were still rolling.

## Repro
roll_dice (damage, target) → apply_damage (kill) → remove_monster in quick succession; watch /table.

## Root cause / Fix
TablePage rendered the live state; only the turn marker (shownTurn), death pose (heldStanding) and
effects/moments waited for the dice. New pure `table/boardHold.ts`: `holdBoard` keeps old HP and
removed monsters (with their token) while busy, lets a removed monster stay while its death
animation plays (`animating` ref of token moments), HOLD_CAP_MS cap, scene change drops it;
`displayState` builds the drawn state. TablePage: `live` from useServer, `state` = displayState,
synced in `syncBoard` (renamed from syncTurn). Tests: boardHold.test.ts. Checked on a demo
server: "healthy" during the dice, "defeated" ~3 s, then gone.

## Notes
- The initiative strip still reads the live `combat.order`, so a removed monster leaves the strip
  at once; minor.
- With several hits in a row the HP jumps from the first value to the last after the dice, not
  step by step.

## TODOs
- [ ] Live check with the voice DM.

## Completed
- 2026-10-20: Fixed with regression tests and a demo-server check.
