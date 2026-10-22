# Bug: a seat claimed from the home network showed offline and could be taken while in use
Status: fixed (2026-10-22)
Area: server (hub.ts, routes/auth.ts)

## Overview
Found in the online-play PR review (B3). Under `TRUST_LAN` a player cookie arriving from the home
network is lifted to `table` level (`accessFor` takes the higher level) but still carries
`access.playerId`. `Hub.connectedPlayers()` and the close bookkeeping (`seatClosedAt`) counted only
`level === "player"`, so a player who joined with the invite link on the home Wi-Fi showed "joined,
offline" on the host's Online card, and after the 2-minute grace a remote sign-in could force-take
the seat while the phone was still using it. Kick also missed that phone's sockets.

## Repro
TRUST_LAN on; join + claim Ana from 192.168.1.7; open `/ws` from the LAN with that cookie;
`GET /api/auth/sessions` shows `connected: 0`; with the grace past, a remote join + claim of Ana
answers 200 instead of 409.

## Root cause / Fix
- `hub.ts`: `connectedPlayers()` and `closed()` key on `access.playerId` whatever the level.
- `routes/auth.ts`: Kick closes `a.playerId === playerId`; a claim switching seats closes
  `a.sid === token.sid` (any level). Rotate stays player-level (LAN phones keep TRUST_LAN).

## Notes
- Tests: hub.test.ts ("a LAN-lifted player cookie counts for its seat"), app.auth.test.ts ("a seat
  claimed from the home network is online and held…", "kicking a seat closes its home-network
  socket too").

## TODOs

## Completed
- 2026-10-22: fixed with tests.
