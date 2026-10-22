# Bug: The DM ignores "Build by voice"
Status: fixed (2026-10-22), live check pending
Area: server / realtime / host UI

## Overview
At the 2026-10-21 session the host pressed **🗣 Build by voice**, and the DM never interviewed the
player. It ran the adventure instead. The campaign (cmp_04ee010393) was reset before play started
at 19:31, which wiped its events, so the attempt left no trace. The cause was found in the code.

## Repro
1. Press Build by voice on the Party tab before Start DM (the usual setup order).
2. Start the DM. The opening is "Welcome… introduce the hook… set the scene", and the DM never asks
   about the character.
With the DM already running, the host note did arrive, but the instructions only showed the build
as a status block at the end of the prompt, with no order to pause the story.

## Root cause / Fix
- `startCharacterBuilder` dropped the result of `notifyDm`, so an offline DM was never told, and
  the host wasn't either. It now returns `dmInformed`, and `BuilderPanel` (prop `dmOffline`) shows
  "The DM is offline: the interview starts when you start the DM".
- `openingPrompt` ignored `state.builder`. With a build active it now greets the table, runs the
  interview (`builderSteps`, game/builder.ts) and holds back the hook until `finalize_character`.
- Restore and resume notes forgot the build. The `dmHost.recentContext` now appends
  `builderStatus(b)`.
- The `CHARACTER BUILDER ACTIVE` block now says "this comes first", pauses the story and includes
  the interview steps. The persona's NEW CHARACTERS section says the same.
- Tests: `game/player.test.ts` (offline start → `dmInformed` false, opening and recentContext) and
  `realtime/instructions.test.ts` (opening with and without a build, the instructions block).

## Notes
- Live verification with the real Realtime model is still pending (general/live-test-checklist.md §4).

## TODOs
- [ ] Live check at a real table (start before and after the DM)

## Completed
- 2026-10-22: Fixed with regression tests.
