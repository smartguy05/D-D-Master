# Bug: the 30 s push-to-talk hold cap ended long holds without warning
Status: fixed (2026-10-22)
Area: shared (FloorView), server (game/service.ts floorView), web (TalkButton, TablePage banner, host Talk button)

## Overview
Phase B review (PR #1, B10). `FLOOR_MAX_HOLD_MS` (30 s) releases a hold on its own. The holder kept
talking with the button still down, the DM stopped hearing them, and nothing said why.

## Repro
Hold a talk button for over 30 s while talking: after the cap the button looks normal/held but the
DM hears nothing.

## Root cause / Fix
- `FloorView.holdLeftMs?` (optional, omitted when nobody holds it): ms left before the cap as of
  sending, in every floor broadcast and the snapshot. Relative rather than a `heldUntil` timestamp,
  because a phone's clock may be off from the server's. Test: service.floor.test.ts "the floor tells
  everyone how long the hold has left before the cap (holdLeftMs)".
- `lib/floor.ts` `holdSecondsLeft(floor, receivedAt, now)` (last `HOLD_WARN_MS` = 10 s only) and
  `lib/useHoldCountdown.ts` (ticks while counting). TalkButton, the /host Talk button and the TV
  banner show "(N s left)"; a press still held after its hold ended shows "Time's up: let go and
  press again" (`TalkPress.expiredFor`). No auto re-press after the cap.

## Notes
- `app.auth.test.ts` WebSocket floor expectation now allows `holdLeftMs: expect.any(Number)`.

## TODOs
- [ ] Live check: hold 30 s on a phone and the TV; countdown then "Time's up"

## Completed
- 2026-10-22: Fixed with tests.
