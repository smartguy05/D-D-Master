# Bug: a host cookie could not be revoked (logout only cleared the browser's copy)
Status: fixed (2026-10-22)
Area: server (auth/store.ts, auth/token.ts, auth/index.ts, routes/auth.ts), web (host/OnlineCard.tsx)

## Overview
Found in the online-play PR review (B4). `verifyToken` checked a host token only against the
password fingerprint and its 30-day age. Logout cleared the cookie in that browser, but a copy
(another device, a stolen cookie) stayed the host for up to 30 days unless `HOST_PASSWORD` changed.

## Repro
Sign in at `/login` remotely, keep the cookie, `POST /api/auth/logout` with it: the same cookie
still reads `/api/campaigns` (200).

## Root cause / Fix
- `auth.json` keeps `hostGen` (missing in old files = 1, the loader stays tolerant);
  `AuthStore.bumpHostGen()`.
- Host tokens carry `hg` (`Auth.issue`); `verifyToken` refuses a host token whose `hg ?? 1` isn't
  `ctx.hostGen`. Decision: a pre-upgrade host token (no `hg`) counts as generation 1, so it keeps
  working until the first bump.
- Host logout bumps `hostGen` and closes every host-cookie socket (`Access.hostCookie`): logging out
  anywhere signs every host device out.
- `POST /api/auth/hosts/revoke` (host): bumps, closes every host-cookie socket (the caller's too,
  code 4012 so it reconnects; see host-revoke-spares-copied-cookie.md), re-issues the caller's cookie
  with the new `hg` and a fresh sid (none for the local bypass). Online card button "Sign out other
  host devices" (only when host sign-in is on).

## Notes
- Tests: auth/token.test.ts (host generation), auth/store.test.ts (hostGen persists; old file loads
  as 1), auth/access.test.ts (hostCookie, route level), app.auth.test.ts (host logout revokes;
  sign out other host devices; every host socket closes, a copied cookie's included).

## TODOs

## Completed
- 2026-10-22: fixed with tests.
