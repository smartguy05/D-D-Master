# Bug: attacks with a target are not checked against its AC, so misses deal damage
Status: fixed (2026-10-20)
Area: server (engine rolls)

## Overview
`roll_dice` / `request_player_roll` with `target_id` but no `dc` return no `success`, so neither
the DM nor the TV knows whether the attack hit. The DM guesses and applies damage on misses.

## Repro
Test run 2026-10-19, 3 times:
- Brienne longsword 10 + Bless 2 = 12 vs Skeleton AC 14 → DM applied 11 damage (events 405–408).
- Kobold dagger 15 vs Morra AC 16 → 3 damage (509–511).
- Kobold dagger 15 vs Morra AC 16 → 5 damage (597–599).
The TV attack animation has no hit/miss outcome either (`attackOutcome` returns undefined).

## Root cause / Fix
`request_player_roll`/`roll_dice` (`engine/tools.ts`) pass `dc: a.dc` only; nothing defaults it to
the target's AC. Fix: when `target_id` names a creature and `dc` is missing, use its AC (and say so
in the result: `vs AC 14: miss`). The DM can still pass a `dc` for cover etc.

## Notes
Bless/other bonus dice are rolled separately, so the result should also tell the DM "add any
bonus dice before deciding" — or let the tool take a bonus notation.

## TODOs
## Completed
- [x] 2026-10-20: Default dc = target AC for targeted d20 rolls; test
- 2026-10-20: Targeted d20 rolls (roll_dice/request_player_roll, physical pending too) default dc to the target's AC and return vs_ac; nat 20 hits, nat 1 misses; not for the roller's own rolls; secret attacks keep hit/miss off the TV (hit in DM output only). Tests: engine/rolls.test.ts, engine/attack-rules.test.ts. Bonus dice go in the notation (persona).
