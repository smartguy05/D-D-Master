# Bug: putting the tunnel in PUBLIC_URL sent in-room phones through the tunnel
Status: fixed (2026-10-22)
Area: server (config.ts, auth/index.ts, routes/auth.ts), web (host/online.ts, OnlineCard.tsx), docs

## Overview
The phase 1 docs said to put the Cloudflare Tunnel address in `PUBLIC_URL`. But `PUBLIC_URL` also
drives the TV's join QR code and the host's player QR codes (`lanUrls` lists it first, `preferred`).
An in-room phone scanning it went through Cloudflare, got `CF-Connecting-IP`, was classed remote and
sent to `/join`, breaking "no code on the LAN".

## Repro
`PUBLIC_URL=https://dnd.example.com`; the TV's QR is `https://dnd.example.com/player`; a phone opening
it gets 401 on `/api/player-urls` and `/ws` and lands on `/join`.

## Root cause / Fix
One setting was used for two addresses. New `ONLINE_URL` (the tunnel) feeds only the Online card's
invite link and the startup log; `PUBLIC_URL` stays the LAN base for QR codes. Both are accepted
`Origin`s and trusted host names. `/api/auth/sessions` returns `onlineUrl` instead of `publicUrl`.

## Notes
- Tests: config.test.ts (ONLINE_URL), app.auth.test.ts (sessions `onlineUrl`), host/online.test.ts.
- Docs: setup/online-play.md, setup/configuration.md, web/host-ui.md, server/http-api.md.

## TODOs

## Completed
- 2026-10-22: fixed before the phase 1 commit.
