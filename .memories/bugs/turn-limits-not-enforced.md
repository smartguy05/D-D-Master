# Bug: The DM didn't enforce movement, action or reaction limits
Status: fixed (2026-10-19)
Area: server (engine, realtime persona), web (TV, phone)

## Overview
In combat, players could move any distance, attack several times, or act on another creature's
turn. The voice DM went along with it.

## Repro
Start combat with a level 1 fighter and say "I run 60 feet and attack the goblin twice". The DM
called `move_token` and two attack rolls, and no tool objected.

## Root cause / Fix
Combat state had only `round`, `turnIndex` and `order`. `move_token` didn't check distance, and
attack rolls didn't check whose turn it was or whether the action was used. `Character.speed` was
stored but never read, and monsters had no speed. The only per-turn rule was a warning for a second
spell slot.

Fix: a turn budget (`combat.turn`, `combat.reactionsUsed`) and a gate in `executeEngineTool`
(`engine/economy.ts`) that refuses DM calls past it. See `.memories/features/turn-economy.md`.

## Notes
- The realtime model follows the player's lead. It needs the engine to say no; asking it in the
  persona alone isn't reliable (same lesson as `fog-never-enabled.md`).

## TODOs
- (none)

## Completed
- 2026-10-19: Turn economy enforced (tests in `engine/economy.test.ts`)
