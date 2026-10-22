# Bug: with TRUST_LAN off, a home-network phone's push-to-talk hold didn't open the room mic
Status: fixed (2026-10-22)
Area: server (hub.ts, app.ts, game/service.ts pttHolder)

## Overview
Found in the phase 3 review. `pttHolder` set `inRoom` from the socket's access level (table level =
in the room). With `TRUST_LAN=0` an in-room phone signs in with the table code and gets a player
cookie, so its hold was `inRoom: false` and `/table` kept the room mic closed: the player's words
never reached the DM.

## Repro
`TRUST_LAN=0`, phone on the home network joins with the code, holds the button: holder
`{playerId, inRoom: false}`.

## Root cause / Fix
Being at the table is about where the socket connects from, not what it may do. The WS upgrade
passes the origin kind (`auth.caller(...).origin.kind`) to `Hub.add(ws, access, origin)`;
`Hub.inRoom(ws)` is true for `local`/`lan` (and, without a known origin, for anything but a player
cookie); `pttHolder` uses it for seat holds. Tests: hub.test.ts ("inRoom comes from the upgrade's
origin…"), service.floor.test.ts ("in the room by origin, not by access level"), app.auth.test.ts
("with TRUST_LAN off, a home-network player cookie holds the floor in the room; a tunnelled one
doesn't").

## Notes
- A host cookie through the tunnel naming a seat now holds it with `inRoom: false`.

## TODOs

## Completed
- 2026-10-22: fixed with tests (phase 3 review).
