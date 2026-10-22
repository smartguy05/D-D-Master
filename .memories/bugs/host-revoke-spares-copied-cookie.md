# Bug: "Sign out other host devices" left a copied host cookie's socket open
Status: fixed (2026-10-22)
Area: server (routes/auth.ts, hub.ts)

## Overview
Found reviewing the phase B fixes. `POST /api/auth/hosts/revoke` closed host-cookie sockets with
`a.sid !== mine`. A copy of the caller's cookie (the threat in host-cookie-not-revocable.md) has
the same sid, so its full-tier /ws socket stayed open and kept getting the unprojected state (the
heartbeat keeps it alive) even though its HTTP requests now failed. The caller's cookie was also
re-issued with the same sid.

## Repro
Two /ws sockets on the same host cookie; revoke from it: the second (the "copy") never closes.

## Root cause / Fix
- The route closes every host-cookie socket, the caller's too: no socket can be told apart as the
  caller's. The re-issued cookie gets a fresh sid (`auth.newSid()`).
- Closing with `4401` would make the caller's page ask `/api/auth/me` at once, which could race the
  browser storing the new cookie and send the host to `/login`. `Hub.closeWhere(pred, code)` now
  takes a code; revoke uses `WS_RECONNECT` (4012): the client retries after 1.5 s with no `/me`
  check (the new cookie is in by then); a copy's upgrade is refused and it then signs in.
- Test: app.auth.test.ts "signing other host devices out closes every host socket, a copy of the
  caller's cookie included" (closes with 4012, fresh sid, new cookie connects, old one refused).

## Notes
- The web client needs no change: any code other than 4401 on an opened socket just reconnects.

## TODOs

## Completed
- 2026-10-22: fixed with tests.
