# Bug: the DM goes silent after announcing a monster's turn
Status: fixed (2026-10-18)
Area: server (realtime session, engine combat)

## Overview
In combat the DM said "Next up: Awakened Shrub 2. It writhes, ready to strike. Let's see where it
moves." and then nothing happened. The table waited for the DM, and the DM waited for the table.

## Repro
Play-test, Lantern Market: two Awakened Shrubs, initiative Shrub 1, Shrub 2, Sylvaine, Bram. After
Shrub 1's attack the DM announced Shrub 2's turn in a speech-only reply, with no tool call.

## Root cause / Fix
`DmSession.onResponseDone` only continues by itself after function calls: it runs them and sends
`response.create`. A speech-only reply ends the loop until someone speaks. The model treats "let's
see what it does" as a pause, and the persona only said "narrate each turn, next_turn".
Fix, in three layers:
- `engine/turns.ts`: `start_combat`/`next_turn` return an `instruction` on a monster/NPC turn (take
  the whole turn in this reply, then `next_turn`).
- Persona: run every monster/ally turn completely in one reply; never end on announcing one.
- Session stall nudge: after a completed speech-only reply with nothing queued, `host.stalledTurn()`
  (GameService → `stalledTurn(state)`) names the open DM-played turn, and the session adds a prompt
  and requests a response. It skips replies ending in "?" (waiting for a reaction). Limits: 1 nudge
  per run of speech-only replies, 3 per turn key.
Tests: `session.test.ts` ("DmSession stalled combat turns"), `engine/npcs.test.ts` ("DM-played
combat turns").

## Notes
- The question-mark heuristic means "Shrub 2 lunges, what do you do?" on a monster's turn isn't
  nudged. That's deliberate: a reaction prompt has to wait for the player.
- If the DM hasn't called `next_turn` after the previous monster acted, the turn key still names
  that monster. The prompt says "if its turn is already over, call next_turn now".

## TODOs
- [ ] Live-test with the voice DM: check the nudge doesn't make it repeat itself out loud. (see general/live-test-checklist.md)

## Completed
- 2026-10-18: Turn instruction, persona line and session stall nudge.
