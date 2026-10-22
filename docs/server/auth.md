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
audited_by: claude
status: current
change_log:
  - "2026-10-22: Review: hosts/revoke closes every host-cookie socket, the caller's too (a copied cookie shares its sid), with WS_RECONNECT (4012), and re-issues the caller's cookie with a fresh sid (bugs/host-revoke-spares-copied-cookie.md)"
  - "2026-10-22: B3/B4/B5/B9: seats tracked by playerId at any level (TRUST_LAN cookies); host generation (hg/hostGen) revokes host cookies on logout and via POST /api/auth/hosts/revoke; player-urls is table; /ws heartbeat"
  - "2026-10-22: LOCAL_FORWARDER: a forwarder that passes the client's Host through gives the host bypass, not LAN trust; with it every loopback peer is remote. canMuteRoom hides the phone mic button below table access"
  - "2026-10-22: A1: POST /api/players/:id/mic is a table route (it mutes the room); A5: ONLINE_URL's host is remote whatever the peer (remoteHosts), local needs a loopback Host name, no Host is lan at most"
  - "2026-10-22: Hub.closeWhere runs the close listeners at once and drops the closed socket's later frames"
  - "2026-10-22: /api/dm/say caps text (SAY_MAX), throttles seat-bound callers (SAY_MIN_GAP_MS) and refuses typing over another holder of the floor"
  - "2026-10-22: Web side: /join sends a remote player to /play/:id, others to /player/:id (seatPage)"
  - "2026-10-22: Hub.add stores the upgrade's origin kind (Hub.inRoom for push-to-talk); POST /api/push-to-talk and /api/floor/release listed as host routes"
  - "2026-10-22: Hub.accessOf: push-to-talk seat checks on ptt"
  - "2026-10-22: Viewer tiers link; server-side filtering is done (state-projection.md)"
  - "2026-10-22: Global sign-in budget counts and blocks only remote callers; test for the seat grace window after a socket closes"
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
- Player allowlist: `GET /api/rtc/config`, `POST /api/dm/say` (the handler
  also checks `playerId` is the caller's own seat, caps the text at `SAY_MAX`, and refuses a
  seat-bound caller within `SAY_MIN_GAP_MS` of its last message or while another holds the floor), `GET/POST /api/auth/claim`, and the seat routes
  `/api/players/:id/{roll, physical-roll, notes (GET, PUT), spells, dice-mode}` with `:id` equal to the
  bound seat. Host-side player routes (`PATCH/DELETE /api/players/:id`, `enroll/*`, `ai/nudge`) stay
  host-only.
- Table: `GET /api/player-urls` (the server's LAN addresses, for the QR codes on the TV and the host,
  `lib/join.ts`; a tunnelled player has no use for them), `POST /api/mic`, `POST /api/players/:id/mic` (a phone's mic button: it mutes the **whole
  room's** mic, so a remote seat must not have it; LAN phones under `TRUST_LAN` keep it; the web
  page hides the button below table access, `lib/auth.ts` `canMuteRoom`, since a 401 would send it
  to `/join`),
  `POST /api/npc/clip-ended`, `POST /api/dm/voice` (the SDP offer).
- Listed as host explicitly (they would be by default): `POST /api/push-to-talk`,
  `POST /api/floor/release` (free the push-to-talk floor) and `POST /api/auth/hosts/revoke`.
- Public: `POST /api/auth/host|join|logout`, `GET /api/auth/me`, and every non-API route.

The `onRequest` hook in `app.ts` answers `401 {error}` when the level is too low and
`403 {error: "That's another player's seat."}` for a signed-in player on another seat's route. It
stores the caller's access on `req.access`.

## Where a request comes from (`auth/origin.ts`)

**Behind the tunnel every request arrives from 127.0.0.1**, so "it's localhost" can't mean "it's the
host". `classifyOrigin(remoteAddr, headers, {trustedHosts, remoteHosts})` returns `{kind: local | lan | remote, ip}`:

1. Any `cf-connecting-ip` header means Cloudflare: **remote**, always.
2. `x-forwarded-for` (a proxy on this machine, e.g. the Vite dev server with `xfwd`): the **last** hop,
   the one the proxy added (earlier hops are whatever the client wrote). It can only lower the
   peer's trust, never raise it: a LAN phone can't claim to be 127.0.0.1.
3. Otherwise the peer address: loopback is local; RFC 1918, link-local and IPv6 ULA are lan; the rest
   is remote. IPv4-mapped IPv6 (`::ffff:192.168.1.7`) is unwrapped.
4. **DNS rebinding.** A local or lan request whose `Host` is a public DNS name (a page on
   `evil.example` that resolved to 127.0.0.1) is remote. Accepted names: IP literals, `localhost`,
   single labels (`gamebox`), `.local`, `.lan`, `.home`, `.home.arpa`, `.internal`, `.localdomain`,
   `PUBLIC_URL`'s host, and `TRUSTED_HOSTS` (a router's own suffix such as
   `fritz.box` or `attlocal.net`; an entry covers its subdomains). Any other dotted name from the LAN
   is remote, so a device that opens the server as `gamebox.fritz.box` needs that entry.
5. **`ONLINE_URL`'s host is remote** (`remoteHosts`, subdomains too), whatever the peer. A local
   proxy that adds no forwarding header (`ssh -R`, nginx keeping `Host`) makes an internet caller
   arrive from 127.0.0.1; an **honest** browser still names `ONLINE_URL`'s host, which gives it away.
6. **Local needs a loopback `Host` name**: `localhost`, `*.localhost`, `127.0.0.0/8` or `::1`. A
   loopback peer with any other home name (`gamebox.local`, the LAN IP, `0.0.0.0`), or with **no
   `Host`** (a non-browser, or a proxy that dropped it), is **lan at most**: it never gets
   `HOST_LOCAL_BYPASS`, only `TRUST_LAN`'s table access. Open the host page on this machine as
   `localhost`.
7. **Rules 5 and 6 only hold for a proxy that sets the headers itself.** `Host` and
   `X-Forwarded-For` are written by the client. A forwarder that passes them through unchanged and
   adds none of its own (`ssh -R`, socat, nginx with `proxy_set_header Host $host` and no
   `X-Forwarded-For`) lets an internet caller send `Host: localhost` and get **the host bypass**,
   not LAN trust. The same goes for a proxy that rewrites `Host` to `localhost`/`127.0.0.1` and adds
   no `X-Forwarded-For` (nginx's default `proxy_pass http://127.0.0.1:8787`). With such a forwarder
   set **`LOCAL_FORWARDER=1`** (`localForwarder`): every loopback peer is then remote whatever it
   sends, and keeps 127.0.0.1 as its rate-limit key. This machine's own browser signs in like
   anyone else (`HOST_PASSWORD`, the table code); the LAN is unchanged. Proxies that set
   `X-Forwarded-For` themselves (Caddy, nginx with `$proxy_add_x_forwarded_for`) and cloudflared
   (`CF-Connecting-IP`) don't need it (see [online play](../setup/online-play.md#2-cloudflare-tunnel)).

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

Payload `{k: host | player, sid, pid?, gen, iat, pw?, hg?}`:
- `sid`: a random id per sign-in. A seat claim belongs to one sid.
- `pid`: the bound seat; missing right after `/join`, before the player picks one.
- `gen`: the code generation. **Rotating the code bumps it, so every player cookie dies.**
- `pw`: host tokens carry a fingerprint of `HOST_PASSWORD`, so changing or clearing the password
  signs every host out. Host tokens ignore `gen` (rotating the code doesn't sign the host out).
- `hg`: host tokens carry the **host generation** (`hostGen` in `auth.json`); a host token of any
  other generation is refused. A host logout and **Sign out other host devices**
  (`POST /api/auth/hosts/revoke`) bump it, so a host cookie can be revoked on the server, not just
  cleared in one browser. A host token from before `hg` existed counts as generation 1, so it keeps
  working until the first bump.

`verifyToken` also refuses expired (30 days) or future-dated tokens and, for a bound player token,
**a seat no longer held by that sid**. That is how Kick and logout revoke a cookie: no separate
revocation list.

## Persistent state (`auth/store.ts`)

`AuthStore` keeps `<DATA_DIR>/auth.json` (mode 600, rewritten on every change): the cookie
`secret` (made once), the table `code`, `gen`, `hostGen` (missing in older files = 1;
`bumpHostGen()`), and `claims` (seat → `{sid, at}`).
- No `TABLE_CODE`: a code like `WOLF-RUNE-7342` is made once (`newTableCode`: 48 × 48 words ×
  10 000 numbers, 23 million codes; the code is the only lock on the tunnel). Rotate makes a new one, bumps `gen` and frees every seat.
- `TABLE_CODE` set: the code is fixed and Rotate refuses. When the value in `.env` changes, the next
  start bumps `gen` (everyone signs in again).
- Codes compare without case, spaces or dashes (`normalizeCode`), in constant time.
- A seat is held by one sid until it is released (Kick, logout, rotate) or taken over. A sid moving
  to another seat frees its old one. A corrupt `auth.json` is replaced with a warning.
- **Takeover** (`POST /api/auth/claim`, `claim(..., {force})`): a seat held by another sid is in use
  while a socket bound to it (a player cookie at any level: `TRUST_LAN` lifts a home-network one
  to table but it still holds the seat) is open, or was within `seatGraceMs` (2 min) of now, or the
  claim itself is that new (`Hub.seatLastSeen`). Otherwise the holder is gone (cleared cookies,
  another browser) and the new sign-in takes the seat: the old cookie stops working. In use = 409.

`Auth` (`auth/index.ts`) bundles the store, the `FailureLimiter`, the password and the policy. The
limiter (`auth/ratelimit.ts`) counts wrong codes and passwords: 10 per address in 10 minutes, IPv6
counted per **/64** (`limitKey`, since one IPv6 caller usually holds a whole /64), and a **global
budget** of 100 from remote callers together, after which every remote caller waits (a warning is
logged once: someone may be guessing the code, rotate it). LAN and this-machine callers neither count
toward nor wait on the global budget, so internet guessers can't lock the room's host out of `/login`. Blocked = 429 with `retry-after` in seconds. `index.ts`
makes one (`Auth.fromConfig(Auth.defaultFile())`) and passes it to both listeners; `buildApp`
without one uses an in-memory store (tests).

## WebSockets

The upgrade handler in `app.ts` checks `Origin`, computes the caller's access from the upgrade
request's cookie and address, and refuses with a bare `401`/`403` response:
- `/ws` needs `player`; `/ws/audio` needs `table`, and `?role=host` (the enrollment mic) needs `host`.
  `audioRoleOf(url)` parses the role once for both the check and the socket's registration.
- `Hub.add(ws, access, origin)` stores the access and the upgrade's origin kind (`Hub.inRoom`:
  `local`/`lan` is in the room, for push-to-talk `inRoom`, whatever the access level). A `hello` is **clamped** (`clampRole`): a player is always
  `player` with its bound `playerId`; a table can't claim `host`. Listeners see the clamped hello.
  `Hub.accessOf(ws)` hands the access to listeners: a push-to-talk `ptt` from a player cookie may
  press only for its own seat, a table-access socket for any human seat, and only `/table` or
  `/host` for the room ([push-to-talk](realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts)).
- The socket's access and clamped role also set its **viewer tier**: player sockets get the public
  projection of the state and events ([state projection](state-projection.md)).
- `Hub.closeWhere(pred, code?)` closes sockets with code `4401` (`WS_SIGNED_OUT`) by default: Kick closes every socket
  bound to that seat (by `playerId`, so a `TRUST_LAN` phone too), Rotate every player-level socket
  (LAN phones keep `TRUST_LAN`), a new claim the sid's old sockets (by `sid`, any level), logout the
  sid's sockets, a host logout every host-cookie socket (`access.hostCookie`), and
  `hosts/revoke` every host-cookie socket, the caller's too (a copy of its cookie has the same sid,
  so no socket can be told apart as the caller's), with `4012` (`WS_RECONNECT`): the client
  reconnects after its 1.5 s delay without the `/api/auth/me` check that `4401` triggers, which could
  beat the re-issued cookie and send the caller to `/login`. The caller's tabs come back with the new
  cookie (a fresh sid); a copy's upgrade is refused and it signs in. It runs the close listeners right away (floor release, leaving the call) and the
  socket's later frames are ignored, even if the client never answers the close frame. `Hub.connectedPlayers()` (sockets per bound seat, any level) feeds the host's Online card; `Hub.seatLastSeen()` the
  seat takeover rule.
- **Heartbeat** (`Hub.startHeartbeat`, started by `createSockets` in `app.ts` for `/ws` only): every
  `HEARTBEAT_MS` (10 s) each socket is pinged; one that has not answered the previous ping is
  `terminate()`d and goes through the close path at once (floor released, call left). A phone that
  drops off Wi-Fi mid-press no longer holds the floor until the 30 s cap. It stops when the `/ws`
  server closes (`app.close()` closes the socket servers that app made).

## Web side

- `lib/api.ts`, the raw fetches in `lib/voice.ts` (SDP offer) and `host/CampaignFiles.tsx` (import):
  a `401` from a non-`/api/auth/` route calls `redirectToSignIn()` (`lib/auth.ts`): `/login?next=` from
  host pages, `/join?next=` from `/player*` and `/play*`. Never from a sign-in page (no loops).
- `lib/useServer.ts`: when `/ws` closes without ever opening, or with `4401`, it asks
  `GET /api/auth/me`; if that level can't use the page's role (`afterSocketClose`) it goes to sign in
  instead of retrying forever. A drop after a good connection just reconnects.
- After a seat is picked, `/join` goes to `seatPage(me.origin, id)` (`lib/auth.ts`): `/play/:id` for a
  `remote` origin, `/player/:id` otherwise (home network, this machine).
- `/login` (`signin/LoginPage.tsx`) and `/join` (`signin/JoinPage.tsx`): see
  [online play](../setup/online-play.md#players-join). `safeNext` keeps `?next=` on this site: it refuses backslashes and control characters (browsers drop
  tab/CR/LF, so `/\t/evil.com` would become `//evil.com`), resolves the path like the browser and
  keeps it only if the origin is unchanged.
- Host Party tab **Online** card (`host/OnlineCard.tsx`, helpers in `host/online.ts`).

## Not covered yet

- A kicked player who still knows the code can join again: rotate the code too.
