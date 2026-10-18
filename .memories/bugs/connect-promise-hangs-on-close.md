# Bug: DmSession.connect() never settled when the session was closed before opening
Status: fixed (2026-10-18)
Area: server

## Overview
If `close()` ran while the first sideband connection was still opening (host pressed Stop, or a
new `startVoice` replaced the session), the `connect()` promise stayed pending forever, so
`startVoice`'s `.then(begin/resume)` / `.catch` never ran.

## Repro
`dm.connect()` → `dm.close()` before the socket's `open` event. The `close` handler returned early
because `closed` was set, and nothing rejected the promise.

## Root cause / Fix
The resolve/reject callbacks were only passed to the first `openSocket` call and only settled on
`open` or on a close of a never-opened socket while not closed. Fix (with the restart re-attach
work): the pending promise is stored in `firstConnect` and settled by `open`, by the final failed
attempt, and by `close()` (rejects "closed before it opened"). `startVoice` and `reattachVoice`
ignore the rejection when `this.dm` is no longer that session, so a superseded session doesn't
raise an error toast. Covered by "retryFirstConnect: close() during the retry wait…" in
`session.test.ts` and "stopDm … supersedes a re-attach" in `service.voice.test.ts`.

## Notes
Harmless before (a leaked promise), but the re-attach path awaits `connect()` and must finish.

## TODOs

## Completed
- 2026-10-18: Fixed in the lost-call / re-attach commit.
