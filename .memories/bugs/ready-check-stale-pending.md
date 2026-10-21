# Bug: A stale ready check let the DM move the party without asking
Status: fixed (2026-10-21)
Area: server

## Overview
The change_scene ready check (game/readyCheck.ts) stored one pending check: the target location
and the human-input count at the ask. It never expired. If the DM asked "ready to go to Bravo?",
the table talked about something else for half an hour, and the DM later called
`change_scene(Bravo)` again, it went through on that old answer. The pending check also survived
the party being moved some other way (host *Go here*, split focus), a campaign load and a new DM
session.

## Repro
1. The party is at Alpha. The DM calls change_scene(Bravo) and is refused ("ask Lia...").
2. Someone says anything. Twenty minutes and many lines pass.
3. The DM calls change_scene(Bravo): it passes without a fresh question.

## Root cause / Fix
There was no time or input window, and nothing cleared the pending check except a passing
change_scene. Fix:
- `ReadyCheck` records `askedAt` (ms) and `fromLocationId`.
- A repeat passes only when all of these hold:
  - a human spoke since the ask;
  - the ask is at most `READY_CHECK_MAX_AGE_MS` (5 min) old;
  - at most `READY_CHECK_MAX_INPUTS` (8) human lines have passed;
  - the party is still at the origin.

  Otherwise the repeat is refused as a fresh check.
- `GameService.commit` clears `readyCheck` whenever `state.locationId` changes, by any path.
- `loadCampaign` and every new, non-handover DM session (`startVoice`, `startText`) clear it too.
- An unknown `location_id` skips the gate, so change_scene returns its normal error instead of a
  ready-check refusal.

Tests in `game/readyCheck.test.ts` cover these cases:
- stale by time;
- stale by inputs;
- a host move clears it;
- load or a new session clears it;
- an unknown location.

## Notes
Found in the readiness review before the first live session. The window values are guesses;
tune them after live play.

## TODOs

## Completed
- 2026-10-21: Fixed.
