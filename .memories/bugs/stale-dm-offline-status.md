# Bug: Stale "offline" status from a replaced DM session
Status: fixed (2026-09-24)
Area: server

## Overview
Restarting the voice DM (or a browser-side WebRTC rebuild) could leave the host and table showing
the DM as `offline` while the new session was live.

## Repro
Voice DM running → POST `/api/dm/voice` again. `startVoice` calls `stopDm()`, which closes the old
`DmSession`, then creates a new one. The old socket's `close` event fires asynchronously, after the
new session has already reported `connecting`/`listening`.

## Root cause / Fix
`DmSession`'s `close` handler always called `host.onStatus("offline", "none")`, even after an
intentional `close()`. `stopDm` already broadcasts `offline`, so the late duplicate only clobbered
the newer session's status. Fix: the close handler does nothing when the session was closed on
purpose, and events from a superseded socket are ignored (`this.ws !== ws`). Covered by
"close() does not emit a stale offline status" in `session.test.ts`.

## Notes
This became more likely with automatic `VoiceLink` reconnects, which replace the session without
the host clicking anything.

## TODOs

## Completed
- 2026-09-24: Fixed together with the sideband auto-reconnect.
