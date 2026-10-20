# Bug: a non-fighting NPC blocked victory and vanished from the TV list
Status: fixed (2026-10-20)
Area: engine (turns.ts combatFoes)

## Overview
After the Awakened Shrub fight, Elian Thorne (an NPC with `combatant: false`, hostile attitude,
not in the initiative order, 4/4 HP) disappeared from the TV's creature list when the battle ended.

## Repro
Combat with one foe plus a hostile NPC added with `combatant: false`. Drop the foe; DM calls
`end_combat {outcome:"victory"}`.

## Root cause / Fix
`combatFoes` counted every living non-ally, non-neutral monster, so the onlooker was a "foe still
standing". The new end_combat guard ([[victory-with-foe-standing]]) refused the victory and told the
DM to `set_disposition neutral`; the DM did, and the TV's ally/foe lists leave neutral creatures
out. Event log: end_combat (refused) → set_disposition mon_41cc741741 neutral → end_combat.
Fix: `combatFoes` keeps a monster that is in the order, or alive and `combatant !== false`.
Also fixes the automatic victory banner and `foes_standing` for the same case.
Test: moments.test.ts "a hostile NPC sitting the fight out (combatant false) is not a foe standing".

## Notes
- The TV still hides neutral creatures from both lists by design; an NPC the DM turns neutral
  drops off the list. Revisit if the table wants a "neutral" group.
- The saved campaign still has Elian as neutral; the host can set them back on the Board tab.

## TODOs
- [ ] Decide whether the TV should show neutral NPCs in their own group.

## Completed
- 2026-10-20: combatFoes skips non-combatants outside the order, with a regression test.
