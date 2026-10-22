# Bug: tunnelled players could read the server's LAN addresses (GET /api/player-urls)
Status: fixed (2026-10-22)
Area: server (auth/access.ts)

## Overview
Found in the online-play PR review (B5). `GET /api/player-urls` was a player-level route, so any
remote player with a table-code cookie could list the server's LAN IPs and URLs. Only `lib/join.ts`
(QR codes and links on `/table` and `/host`) uses it.

## Repro
Join + claim through the tunnel, `GET /api/player-urls` with that cookie: 200 with LAN addresses.

## Root cause / Fix
`ROUTE_LEVELS["GET /api/player-urls"]` is now `table`. Callers (`useJoinBase` in TablePage,
PlayerLinks, OnlineCard) all run with table access or better, and swallow errors anyway.

## Notes
- Tests: auth/access.test.ts (route level), app.auth.test.ts ("the server's LAN addresses
  (player-urls) are for the room").

## TODOs

## Completed
- 2026-10-22: fixed with tests.
