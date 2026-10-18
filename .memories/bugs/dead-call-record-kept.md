# Bug: the saved voice call record outlived a sideband that gave up
Status: fixed (2026-10-18)
Area: server

## Overview
When a live sideband dropped and every reconnect failed, the DM went offline but the
`kv.active_voice_call` record and `GameService.dm` stayed, so the next restart tried to re-attach
to a dead call (31 s of retries) and requests hit a dead session.

## Root cause / Fix
Only `stopDm` cleared the record. Fix: `dmHost(owner)` knows its session; when the current
session reports `offline` on its own it is dropped, the record is cleared and the NPC queue is
emptied. Statuses from a replaced session are ignored. `startVoice`/`reattachVoice` now use
`DmSession.closedByCaller` (not `this.dm !== dm`) to stay silent only for a host Stop/replace.
Test: "clears the record when a live sideband drops…" in `service.voice.test.ts`. The
stale-offline test still passes. Found by the adversarial review (round 1).

## TODOs

## Completed
- 2026-10-18: Fixed (review round 1).
