# Bug: LAN devices using a router DNS name (gamebox.fritz.box) lost TRUST_LAN
Status: fixed (2026-10-22)
Area: server (auth/origin.ts, config.ts)

## Overview
The DNS-rebinding guard only accepted IP literals, single labels and a few private suffixes. A phone
or TV opening the server as `gamebox.fritz.box`, `pc.attlocal.net` and the like was classed remote
and sent to `/join` or `/login`. Before auth those names worked.

## Repro
TRUST_LAN on; `GET /api/players/:id/notes` from 192.168.1.7 with `Host: gamebox.fritz.box:8787` → 401
(with `Host: 192.168.1.20:8787` → 200).

## Root cause / Fix
There is no safe way to tell a router suffix from a public name. New `TRUSTED_HOSTS` (comma list,
covers subdomains) adds home names; `PUBLIC_URL`'s and `ONLINE_URL`'s hosts count too. Documented
in setup/online-play.md, server/auth.md and configuration.md.

## Notes
- Tests: auth/origin.test.ts ("TRUSTED_HOSTS names…"), app.auth.test.ts (fritz.box), config.test.ts.

## TODOs

## Completed
- 2026-10-22: fixed before the phase 1 commit.
