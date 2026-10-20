# Bug: spell conditions the DM adds outlive the spell
Status: fixed (2026-10-20)
Area: server (rules engine) / persona

## Overview
The DM models spell effects as free-text conditions ("Blessed (1d4 to attacks and saves)",
"Incapacitated (until end of next turn)", "Next attack against has advantage"). Ending
concentration (host *◎ End Bless*) clears `concentration` but not those conditions, and timed ones
never expire. Later the DM kept rolling a Bless d4 for Brienne and Morra because the chip was still
there (events 522, 614).

## Repro
Test run 2026-10-19: Morra casts Bless on three PCs → combat ends → Party tab *◎ End Bless* → chips
remain on the TV and sheets until a Long Rest/reset (Blessed survived the long rest too).

## Root cause / Fix
Conditions are plain strings with no link to the caster's concentration or a duration. Ideas: let
`add_condition` take `source_spell`/`until` and clear linked conditions in `end_concentration`; or
have `cast_spell` apply known buffs itself (Bless, Bane, Shield of Faith…) and own their cleanup.

## TODOs
## Completed
- [x] 2026-10-20: Link conditions to concentration / duration; test End Bless clears Blessed
- 2026-10-20: conditionMeta + add_condition source_spell/caster_id/duration_rounds/until_end_of_turn_of (engine/rules/conditions.ts): ends with the caster's concentration, at the duration, at end_combat, on a long rest; plain sources kept. Tests: conditions.test.ts, combat-edge-cases.test.ts.
