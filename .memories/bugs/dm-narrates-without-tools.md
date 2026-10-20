# Bug: the DM narrates state changes without calling the tools
Status: open
Area: server (persona / realtime session) — model behaviour

## Overview
In the 2026-10-19 text-mode test run (OpenAI realtime) the DM often said something happened but
didn't call the tool, so the board and sheets drifted from the story:
- "The potions are yours" — no `give_item` (fixed by a host whisper).
- Described Grout and two kobold guards at the wreck — no `spawn_monster`.
- "Combat is over" — no `end_combat` (initiative strip stayed on the TV).
- "Sister Morra, it's your turn" — no `next_turn` (turn state stuck on Pell); also after Quill's
  Fire Bolt.
- Reward: `adjust_gold` with 37.5 twice per PC, then −100/−33/−34 corrections and an
  `adjust_gold` on a monster id → gold 52/67/98 instead of 60/75/107.

## Repro
See the test run events (campaign cmp_cbe6567b3b, events ~348, 483, 441, 430, 640–654).

## Root cause / Fix
Model reliability. Ideas:
- Persona: "Never narrate an item, spawn, turn change or end of combat without the tool call in
  the same reply."
- `adjust_gold`: `amount` should be `z.number().int()`; refuse non-PC ids clearly; maybe a
  `split_gold {total, character_ids}` tool for rewards.
- Server-side nudges like the stall nudge: e.g. combat active with no living foes → remind to
  `end_combat`.

## TODOs
- [ ] Persona lines + adjust_gold int + end-of-combat nudge
## Completed
