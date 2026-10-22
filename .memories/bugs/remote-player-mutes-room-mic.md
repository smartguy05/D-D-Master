# Bug: a remote (tunnelled) player could mute the whole room's mic
Status: fixed (2026-10-22)
Area: server / auth

## Overview
`POST /api/players/:id/mic` was a seat route (player level, own seat), but `routes/player.ts`
calls `game.setMicMuted`, which flips the **global** table mic. Any remote player with a seat
cookie could cut (or reopen) every voice in the room.

## Repro
Join through the tunnel with the table code, claim a seat, then
`POST /api/players/<own id>/mic {"muted": true}` with the cookie and `CF-Connecting-IP`: 200, and
the DM stops hearing the room.

## Root cause / Fix
`auth/access.ts` listed the route in `SEAT_ROUTES`. Removed it there and gave it `"table"` in
`ROUTE_LEVELS`: the host and LAN phones under `TRUST_LAN` keep the phone's mic button; a remote
player gets 401 ("The host has to do that."; the hook answers 401 for a level shortfall, 403 only
for another seat). `/play` never rendered the button (it lives in `PlayerPage`'s header,
`MicToggle`), so no web change was needed there.
Tests: app.auth.test.ts "muting the table mic from a seat is a table route: a remote player can't,
a LAN phone can"; access.test.ts routeNeed.

## Notes
- With `TRUST_LAN=0`, a home phone signed in with the table code also loses the button (player
  level only); that matches "the room's mic is the table's".
- **Wrong at first:** a player-level phone (remote seat on `/player/:id`, or `TRUST_LAN=0`) that
  tapped `MicToggle` didn't "just do nothing": the 401 made `lib/api.ts` `redirectIfUnauthorized`
  send the page to `/join` mid-session. Fixed: `PlayerPage` asks `/api/auth/me` (on each connect)
  and shows `MicToggle` only when `lib/auth.ts` `canMuteRoom(me)` (table or host). Test:
  auth.test.ts "canMuteRoom (the phone's mic button)". The server keeps 401 for a level shortfall
  (pages rely on it to go to /login).

## TODOs

## Completed
- 2026-10-22: Route moved to table level, with tests.
- 2026-10-22: `MicToggle` hidden below table access (`canMuteRoom`), so a tap no longer signs the phone out.
