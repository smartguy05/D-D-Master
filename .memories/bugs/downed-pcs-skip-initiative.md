# Bug: Downed PCs were left out of initiative, so they could never make death saves
Status: fixed (2026-10-18)
Area: server

## Overview
`start_combat` skipped every character with `hp <= 0`, and `next_turn` never treated a dead PC as
dead. With the rules engine, a PC at 0 HP has to keep a turn: "Whenever you start your turn with
0 Hit Points, you must make a Death Saving Throw" (SRD 5.2.1). A PC already down when combat
started never got a turn, so it never rolled death saves. Dead PCs, in turn, still got turns.

## Repro
1. Thorin is at 0 HP (Unconscious) and combat starts.
2. `start_combat`: Thorin is not in the order, so `next_turn` never lands on him.

## Root cause / Fix
The original check meant "standing" and was written before death saves existed.
`apps/server/src/engine/tools.ts`:
- `start_combat` now skips only dead characters (`isDead`).
- `next_turn` skips dead PCs as well as dead monsters, and makes the death save for a downed PC
  who is not Stable.

Tests are in `engine/rules/vitals.test.ts` ("start_combat keeps downed (not dead) PCs …" and
"asks for physical dice, skips Stable PCs and skips the dead").

## Notes
A PC who drops to 0 during combat was always in the order (it was standing at start_combat).

## TODOs

## Completed
- 2026-10-18: Fixed together with the rules engine (stream A2).
