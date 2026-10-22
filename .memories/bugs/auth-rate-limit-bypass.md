# Bug: sign-in rate limit could be dodged (forged forwarding headers, IPv6 /64, many addresses)
Status: fixed (2026-10-22)
Area: server (auth/origin.ts, auth/ratelimit.ts, auth/store.ts)

## Overview
Found by adversarial review of online-play phase 1 before it was committed. The limit of 10 wrong
codes or passwords per address per 10 minutes could be dodged three ways:
- A LAN device (TRUST_LAN gives it table, not host) sent a new fake `CF-Connecting-IP` with each
  `HOST_PASSWORD` guess: the key came from the header whenever the peer was local **or lan**.
- Through the tunnel an IPv6 caller rotates addresses within its /64 for free.
- No cap across addresses, and the code space was only 48 × 10,000 = 480,000.

## Repro
- 50 × `POST /api/auth/host` from remoteAddress 192.168.1.50 with `cf-connecting-ip: 198.51.100.<i>`:
  all 401, never 429; the 51st with the right password got a host cookie.
- 30 × `POST /api/auth/join` from 127.0.0.1 with `cf-connecting-ip: 2001:db8::<i>`: never 429.

## Root cause / Fix
- `classifyOrigin` trusted forwarding headers for any non-remote peer. Now only a loopback peer
  (cloudflared, Vite on this machine) may name the client address.
- `FailureLimiter` keys on `limitKey(ip)` (IPv6 → /64) and has a global budget (`globalMax`, 100 per
  window) that blocks every address and logs a warning once.
- `newTableCode` makes WOLF-RUNE-7342 (48 × 48 × 10,000 = 23 million).

## Notes
- Tests: auth/origin.test.ts ("only a proxy on this machine…"), auth/ratelimit.test.ts (/64, global
  budget), app.auth.test.ts (LAN rotating CF-Connecting-IP, IPv6 /64, global budget, retry-after),
  auth/store.test.ts (code format).
- The global budget lets an attacker pause remote sign-ins for 10 minutes; in-room play (LAN,
  this machine) needs no sign-in, so that was accepted (general/decisions.md).

## TODOs

## Completed
- 2026-10-22: fixed with tests, before the phase 1 commit.
