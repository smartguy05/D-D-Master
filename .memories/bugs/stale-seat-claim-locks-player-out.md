# Bug: a stale seat claim locked a remote player out of their own seat
Status: fixed (2026-10-22)
Area: server (routes/auth.ts, auth/store.ts, hub.ts)

## Overview
`POST /api/auth/claim` refused a seat whenever another sign-in held it, however old and with no
socket open. A player who cleared cookies or switched browsers (in-app browser → Safari) got 409
until the host noticed and pressed Kick; claims last up to 30 days.

## Repro
Join + claim Ana from one browser, close it; join from a new browser and claim Ana → 409.

## Root cause / Fix
The claim had no notion of liveness. Now a seat held by another sign-in is "in use" only while a
player socket for it is open or was within `seatGraceMs` (2 min; `Hub.seatLastSeen`), or the claim is
that new. Otherwise the new sign-in takes over (`AuthStore.claim(..., {force: true})`) and the old
cookie stops working (a player cookie needs its sid to own the seat).

## Notes
- Tests: app.auth.test.ts (takeover with `seatGraceMs: 0`; an open socket still blocks it),
  hub.test.ts (`seatLastSeen`), auth/store.test.ts (forced claim).

## TODOs

## Completed
- 2026-10-22: fixed before the phase 1 commit.
