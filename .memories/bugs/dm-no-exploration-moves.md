# Bug: The DM narrated exploration moves but never moved a token (fog never cleared)
Status: fixed (2026-10-21), live re-test pending
Area: server (engine, realtime session, persona), shared tools

## Overview
In the 2026-10-21 play-test (cmp_04ee010393, 19:31–20:10) the DM made 6 `move_token` calls, all in the
town square. It made none in the cornfield, mill, graveyard or tower, while narrating "Brannoc carves a path…", "you all
descend…" and answering "I move around the graveyard…". Tokens stayed on the entrance cells
`placeCharacters` gives them, so fog (which only clears around PC tokens) never opened up and the
party seemed to sit at the start until `change_scene` jumped it to the next map.

## Repro
Out of combat, a player says "I head over to the pie stall". The DM narrates arriving and calls no move tool.

## Root cause / Fix
The only "move tokens" line in the persona sat inside the Combat bullet, and moving a 5-PC party
meant five `move_token` calls. Fix, three layers:
- Engine: new `move_party` tool (`to` a feature via `findFeature`, or x/y; `character_ids`
  optional; out of combat only). It walks each token with `planMove` to free cells around the goal,
  and the fog reveal runs after it (engine/move-party.test.ts).
- Session: board watcher `watchReply` (realtime/watch.ts, watch.test.ts) + `DmSession.watchBoard`.
  A finished reply whose player line or narration moved someone, with no move tool, gets one
  `[Board check …]` nudge per player line. It is skipped in combat, and the silent fix is not nudged as an empty
  follow-up (session.test.ts "DmSession board watcher").
- Persona: a top-level "The map follows the story" line (move_party / move_token before narrating);
  the move line is out of the Combat bullet (instructions.test.ts).

## Notes
- The watcher's regexes are heuristics tuned on that session's lines. Watch `[watch]` diag events
  for false positives (e.g. "I go first").
- `move_party` shares the per-reply move cap as one mover (`party`).

## TODOs
- [ ] Live: an exploration scene. Tokens should follow narration and fog should clear (general/live-test-checklist.md).

## Completed
- 2026-10-21: move_party, board watcher, persona line, tests.
