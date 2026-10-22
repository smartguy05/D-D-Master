---
title: Authentication and access control
area: server
topic: auth
related_code:
  - apps/server/src/auth/**
  - apps/server/src/routes/auth.ts
  - apps/server/src/app.auth.test.ts
  - apps/server/src/hub.ts
  - apps/web/src/lib/auth.ts
  - apps/web/src/lib/auth.test.ts
  - apps/web/src/signin/**
created: 2026-10-22
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Review fixes: rate-limit key only from a proxy on this machine, IPv6 /64 buckets and a global budget, two-word table codes, ONLINE_URL apart from PUBLIC_URL, TRUSTED_HOSTS, stale seat takeover, safeNext resolves like the browser"
  - "2026-10-22: Initial version (online play phase 1: table code, host password, Cloudflare Tunnel origin rules)"
---

# Authentication and access control

The server serves a mixed game: people in the room on the home network, and friends online through a
Cloudflare Tunnel. Every HTTP request and WebSocket upgrade gets an **access level** from where it
comes from and its sign-in cookie. Setup steps for players and the host are in
[online play](../setup/online-play.md); the routes are in the [HTTP API](http-api.md#sign-in).

## Access levels (`auth/access.ts`)

| Level | Who | May use |
|---|---|---|
| `host` | a browser on this machine (`HOST_LOCAL_BYPASS`, on by default), or the host-password cookie | everything |
| `table` | the home network (`TRUST_LAN`, on by default), e.g. the TV and LAN phones | the TV's routes (`/api/mic`, `/api/npc/clip-ended`, `/api/dm/voice`, `/ws/audio`) and **any** seat's routes, as before auth |
| `player` | a table-code cookie | its **own** seat's routes, typing to the DM as itself, `/ws` |
| `none` | anyone else | the web app, `/media`, the sign-in routes |

`accessFor(origin, token, policy)` takes the higher of the origin's level and the cookie's.
`routeNeed(method, pattern, params)` maps the route **pattern** Fastify matched (never the raw URL,
so percent-encoding or doubled slashes can't dodge it) to the level it needs:

- Everything under `/api` is **host-only unless listed**. A new route is safe by default.
- Player allowlist: `GET /api/player-urls`, `GET /api/rtc/config`, `POST /api/dm/say` (the handler
  also checks `playerId` is the caller's own seat), `GET/POST /api/auth/claim`, and the seat routes
  `/api/players/:id/{roll, physical-roll, notes (GET, PUT), spells, mic, dice-mode}` with `:id` equal to the
  bound seat. Host-side player routes (`PATCH/DELETE /api/players/:id`, `enroll/*`, `ai/nudge`) stay
  host-only.
- Table: `POST /api/mic`, `POST /api/npc/clip-ended`, `POST /api/dm/voice` (the SDP offer).
- Public: `POST /api/auth/host|join|logout`, `GET /api/auth/me`, and every non-API route.

The `onRequest` hook in `app.ts` answers `401 {error}` when the level is too low and
`403 {error: "That's another player's seat."}` for a signed-in player on another seat's route. It
stores the caller's access on `req.access`.

## Where a request comes from (`auth/origin.ts`)

**Behind the tunnel every request arrives from 127.0.0.1**, so "it's localhost" can't mean "it's the
host". `classifyOrigin(remoteAddr, headers)` returns `{kind: local | lan | remote, ip}`:

1. Any `cf-connecting-ip` header means Cloudflare: **remote**, always.
2. `x-forwarded-for` (a proxy on this machine, e.g. the Vite dev server with `xfwd`): the **last** hop,
   the one the proxy added (earlier hops are whatever the client wrote). It can only lower the
   peer's trust, never raise it: a LAN phone can't claim to be 127.0.0.1.
3. Otherwise the peer address: loopback is local; RFC 1918, link-local and IPv6 ULA are lan; the rest
   is remote. IPv4-mapped IPv6 (`::ffff:192.168.1.7`) is unwrapped.
4. **DNS rebinding.** A local or lan request whose `Host` is a public DNS name (a page on
   `evil.example` that resolved to 127.0.0.1) is remote. Accepted names: IP literals, `localhost`,
   single labels (`gamebox`), `.local`, `.lan`, `.home`, `.home.arpa`, `.internal`, `.localdomain`,
   `PUBLIC_URL`'s and `ONLINE_URL`'s hosts, and `TRUSTED_HOSTS` (a router's own suffix such as
   `fritz.box` or `attlocal.net`; an entry covers its subdomains). Any other dotted name from the LAN
   is remote, so a device that opens the server as `gamebox.fritz.box` needs that entry.

`ip` (the rate-limit key) comes from the forwarding header only when the peer is **loopback** (the
cloudflared or Vite process on this machine). A LAN device or a caller reaching the port directly
keeps its own address, so it can't write a new `CF-Connecting-IP` for every guess.

**Cross-site requests.** `originAllowed(headers, urls)` checks a browser's `Origin` against
`Host`, `X-Forwarded-Host`, `PUBLIC_URL` and `ONLINE_URL` (default ports ignored). It guards every non-GET request
(CSRF against the local bypass) and every WebSocket upgrade (cross-site WebSocket hijacking). A
request without `Origin` is not a browser and carries no victim's cookie, so it passes.

## The cookie (`auth/token.ts`)

`dm_auth` = `base64url(JSON payload).base64url(HMAC-SHA256)`, signed with the secret in
`auth.json` (`node:crypto`, no dependency). `HttpOnly; SameSite=Lax; Path=/; Max-Age=30d`, plus
`Secure` when the request is https or `x-forwarded-proto: https` (the tunnel).

Payload `{k: host | player, sid, pid?, gen, iat, pw?}`:
- `sid`: a random id per sign-in. A seat claim belongs to one sid.
- `pid`: the bound seat; missing right after `/join`, before the player picks one.
- `gen`: the code generation. **Rotating the code bumps it, so every player cookie dies.**
- `pw`: host tokens carry a fingerprint of `HOST_PASSWORD`, so changing or clearing the password
  signs every host out. Host tokens ignore `gen` (rotating the code doesn't sign the host out).

`verifyToken` also refuses expired (30 days) or future-dated tokens and, for a bound player token,
**a seat no longer held by that sid**. That is how Kick and logout revoke a cookie: no separate
revocation list.

## Persistent state (`auth/store.ts`)

`AuthStore` keeps `<DATA_DIR>/auth.json` (mode 600, rewritten on every change): the cookie
`secret` (made once), the table `code`, `gen`, and `claims` (seat → `{sid, at}`).
- No `TABLE_CODE`: a code like `WOLF-RUNE-7342` is made once (`newTableCode`: 48 × 48 words ×
  10 000 numbers, 23 million codes; the code is the only lock on the tunnel). Rotate makes a new one, bumps `gen` and frees every seat.
- `TABLE_CODE` set: the code is fixed and Rotate refuses. When the value in `.env` changes, the next
  start bumps `gen` (everyone signs in again).
- Codes compare without case, spaces or dashes (`normalizeCode`), in constant time.
- A seat is held by one sid until it is released (Kick, logout, rotate) or taken over. A sid moving
  to another seat frees its old one. A corrupt `auth.json` is replaced with a warning.
- **Takeover** (`POST /api/auth/claim`, `claim(..., {force})`): a seat held by another sid is in use
  while a player-cookie socket for it is open, or was within `seatGraceMs` (2 min) of now, or the
  claim itself is that new (`Hub.seatLastSeen`). Otherwise the holder is gone (cleared cookies,
  another browser) and the new sign-in takes the seat: the old cookie stops working. In use = 409.

`Auth` (`auth/index.ts`) bundles the store, the `FailureLimiter`, the password and the policy. The
limiter (`auth/ratelimit.ts`) counts wrong codes and passwords: 10 per address in 10 minutes, IPv6
counted per **/64** (`limitKey`, since one IPv6 caller usually holds a whole /64), and a **global
budget** of 100 from all addresses together, after which everyone waits (a warning is logged once:
someone may be guessing the code, rotate it). Blocked = 429 with `retry-after` in seconds. `index.ts`
makes one (`Auth.fromConfig(Auth.defaultFile())`) and passes it to both listeners; `buildApp`
without one uses an in-memory store (tests).

## WebSockets

The upgrade handler in `app.ts` checks `Origin`, computes the caller's access from the upgrade
request's cookie and address, and refuses with a bare `401`/`403` response:
- `/ws` needs `player`; `/ws/audio` needs `table`, and `?role=host` (the enrollment mic) needs `host`.
  `audioRoleOf(url)` parses the role once for both the check and the socket's registration.
- `Hub.add(ws, access)` stores the access. A `hello` is **clamped** (`clampRole`): a player is always
  `player` with its bound `playerId`; a table can't claim `host`. Listeners see the clamped hello.
- `Hub.closeWhere(pred)` closes sockets with code `4401` (`WS_SIGNED_OUT`): Kick closes that seat's
  player sockets, Rotate every player-cookie socket, a new claim the sid's old sockets, logout the
  sid's sockets. `Hub.connectedPlayers()` feeds the host's Online card; `Hub.seatLastSeen()` the
  seat takeover rule.

## Web side

- `lib/api.ts`, the raw fetches in `lib/voice.ts` (SDP offer) and `host/CampaignFiles.tsx` (import):
  a `401` from a non-`/api/auth/` route calls `redirectToSignIn()` (`lib/auth.ts`): `/login?next=` from
  host pages, `/join?next=` from `/player*` and `/play*`. Never from a sign-in page (no loops).
- `lib/useServer.ts`: when `/ws` closes without ever opening, or with `4401`, it asks
  `GET /api/auth/me`; if that level can't use the page's role (`afterSocketClose`) it goes to sign in
  instead of retrying forever. A drop after a good connection just reconnects.
- `/login` (`signin/LoginPage.tsx`) and `/join` (`signin/JoinPage.tsx`): see
  [online play](../setup/online-play.md#players-join). `safeNext` keeps `?next=` on this site: it refuses backslashes and control characters (browsers drop
  tab/CR/LF, so `/\t/evil.com` would become `//evil.com`), resolves the path like the browser and
  keeps it only if the origin is unchanged.
- Host Party tab **Online** card (`host/OnlineCard.tsx`, helpers in `host/online.ts`).

## Not covered yet

- Phones and remote players still receive the full `GameState` over `/ws` (hidden monsters
  included); server-side filtering is online-play phase 2 (`.memories/features/online-play.md`).
- A kicked player who still knows the code can join again: rotate the code too.
