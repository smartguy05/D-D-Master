# Bug: a voice turn was lost when the noise gate timed out during a sideband reconnect
Status: fixed (2026-10-18)
Area: server (realtime)

## Overview
A real player turn could get no answer: its gate timeout fired while the sideband socket was
closed, and the response request vanished.

## Repro
Voice DM live, `TURN_GATE` on. A player turn is committed, then the sideband drops before the
transcript arrives. 1200 ms later the gate times out and calls `requestResponse()`; the socket
reconnects after that. Found by the adversarial review (round 1).

## Root cause / Fix
`requestResponse()` set `responseActive = true` and `send()` silently dropped the
`response.create` on the closed socket; `onReconnected()` then reset both `responseActive` and
`wantResponse`. Fix: when the socket isn't open, `requestResponse` only sets `wantResponse`
(leaves `responseActive` alone); `onReconnected` keeps a pending `wantResponse`, and the `open`
handler drains it. Tests: "a turn whose gate times out while the sideband is reconnecting…" and
"a response requested while disconnected…" in `session.test.ts`.

## Notes
The same path also covered host whispers and NPC hold releases made while disconnected.

## TODOs

## Completed
- 2026-10-18: Fixed (review round 1).
