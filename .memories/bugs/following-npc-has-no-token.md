# Bug: an NPC following the party has no token on the map
Status: fixed (2026-10-18)
Area: server (engine), web (table, host)

## Overview
An NPC joined the party in the story, but nothing showed on the TV map.

## Repro
Any campaign: the DM narrates that an NPC (e.g. Captain Mara Venn) comes along with the party.

## Root cause / Fix
This was a missing feature. Outline NPCs had no representation in `GameState`: only characters and
monsters had tokens, and no tool put an NPC on the map. Fix: `add_npc` creates a `Monster` with
`npc: true` (plus `ally`, `follows`, `appearance`) beside the party and draws its own portrait
sprite. Followers survive `change_scene` and restaging. Allies get green tokens, a green initiative
entry and their own list on the TV, and stay visible in fog while following. The host Play tab has
an *Add NPC* row. The persona tells the DM to call `add_npc`.
Tests: `engine/npcs.test.ts`, `service.sprites.test.ts` ("GameService NPC sprites"),
`web/table/visibility.test.ts`.

## Notes
- NPCs are Monsters on purpose: damage, initiative, effects, undo and tokens all work unchanged.
  `EntityType` "npc" stays unused.
- `remove_monster` takes an NPC off the map. `add_npc` again with `follows: false` makes it stay
  behind at the next scene change.

## TODOs
- [ ] Phone/player view: show allies?

## Completed
- 2026-10-18: add_npc, followers, ally display, host Add NPC row.
- 2026-10-19: Outline NPC portraits pre-drawn (see features/campaign-gen.md).
