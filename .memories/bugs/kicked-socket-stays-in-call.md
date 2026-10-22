# Bug: a kicked player stayed in the WebRTC call until the close handshake finished
Status: fixed (2026-10-22)
Area: server

## Overview
`Hub.closeWhere` (kick, code rotation, logout) removed the socket from `clients` and called
`ws.close()`, but the close listeners (floor release, `rtc.leave`) ran only on the `close` event.
A client that ignores the close frame stays CLOSING for up to ws's 30 s closeTimeout, and ws still
emits `message` while CLOSING, so the kicked page stayed a call member and its signals were relayed.

## Repro
`hub.test.ts`: a fake socket whose `close()` only sets readyState 2; after `closeWhere` the close
listener had not run and later `rtc` messages still reached `onClientEvent`.

## Root cause / Fix
`Hub.closed(ws, info)` runs the close listeners once (`info.closed` flag); `closeWhere` calls it right
after `ws.close()`, and the later `close` event is a no-op. The message handler ignores frames from a
socket that is no longer in `clients`.

## Notes
- Anything keyed on a socket should go away when the hub drops it, not when TCP finally closes.

## TODOs

## Completed
- 2026-10-22: Immediate close listeners + frame drop, with test.
