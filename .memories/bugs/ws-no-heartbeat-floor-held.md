# Bug: a phone that dropped off Wi-Fi held the push-to-talk floor and its call slot
Status: fixed (2026-10-22)
Area: server (hub.ts, app.ts)

## Overview
Found in the online-play PR review (B9). `/ws` had no heartbeat. A phone that lost Wi-Fi mid-press
never sent a close, so the server kept the socket: the floor stayed held until its 30 s cap and the
seat stayed in the call.

## Repro
Hold push-to-talk on a phone, turn its Wi-Fi off: the floor holder pill stays for ~30 s.

## Root cause / Fix
- `Hub.heartbeat()`: a socket still waiting for the previous ping's pong is `terminate()`d and goes
  through `closed()` at once (floor release and call leave via the close listeners); the rest are
  pinged. `Hub.startHeartbeat(everyMs = HEARTBEAT_MS)` (10 s, unref'd) returns its stop function.
- `createSockets` (app.ts) starts it for the `/ws` server only and stops it on that server's `close`;
  `buildApp` closes the socket servers it made itself on `app.close()` (shared ones in index.ts live
  with the process). `/ws/audio` is untouched.
- `HubSocket` has optional `ping`/`terminate`: in-process fakes without them are skipped.

## Notes
- Tests: hub.test.ts ("heartbeat" describe: terminate after a missed pong, interval + stop),
  app.auth.test.ts ("WebSocket heartbeat (app.ts createSockets)", fake setInterval, stops on app.close).

## TODOs

## Completed
- 2026-10-22: fixed with tests.
