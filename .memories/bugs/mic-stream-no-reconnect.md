# Bug: voice ID dies for good when /ws/audio drops
Status: fixed (2026-10-21)
Area: web

## Overview
After a server restart (or any drop of the `/ws/audio` socket) the host kept sending nothing to
voice ID: players were no longer recognised and enrollment failed until the host page was
reloaded. Nothing on the host showed it.

## Repro
1. Enable the mic on `/host` and start the DM.
2. Restart the server (or kill the socket).
3. `/ws` reconnects, but `/ws/audio` never does; speaker ID stops.

## Root cause / Fix
`MicStreamer.start()` opened the socket once and had no `onclose`. Fix (`apps/web/src/lib/voice.ts`):
`openSocket()` reconnects on close with backoff 1, 2, 4, then 5 s (`MIC_RECONNECT_DELAYS_MS`, reset
on open) until `stop()`; `connected` + `onChange` drive a red "Voice ID offline — reconnecting" pill
on `/host`; `HostPage` stops the streamer on unmount. `createSocket` is injectable.

## Notes
PCM chunks recorded while the socket is down are dropped (no buffering): voice ID only needs the
live turn.

## TODOs
- [ ] Live-check: restart the server with the host open; the pill shows, then clears, and voice ID
      works without a reload. (see general/live-test-checklist.md)

## Completed
- 2026-10-21: reconnect + pill + stop on unmount; voice.test.ts (backoff, reset, stop prevents
  reconnect, late close ignored).
