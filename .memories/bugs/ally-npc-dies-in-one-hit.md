# Bug: story NPC allies die in one hit and are removed
Status: open
Area: server (add_npc, combat) / persona

## Overview
`add_npc` defaults to the SRD Commoner (4 HP, AC 10). Pell Netter, described in the outline as "not
a combatant", was put in initiative, attacked a skeleton, took 4 damage and the DM called
`remove_monster`. The adventure still needed him (he tends the beacon later). The host rewound it.

## Repro
Test run 2026-10-19, lighthouse fight, events 389–392.

## Root cause / Fix
Design gap: allied NPCs have no downed state and join `start_combat` like any monster. Ideas:
allies drop to Unconscious (or "out of the fight") at 0 HP instead of dying; leave non-combatant
NPCs out of initiative unless the DM adds them; persona line to keep key NPCs alive.

## TODOs
- [ ] Decide NPC-at-0-HP rule; implement + test
## Completed
