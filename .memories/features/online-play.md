# Feature: Online / mixed play (room + remote players)
Status: in-progress (phase 1 of 5 done)
Docs: docs/setup/online-play.md, docs/server/auth.md, docs/server/http-api.md, docs/setup/configuration.md

## Overview
Mixed games: some players at the table with the TV and the shared mic, up to 5 friends online. The
host's own machine is the server, reached through a **Cloudflare Tunnel** (`cloudflared` →
`http://localhost:8787`). Remote players join with a **table code**; the host signs in from other
machines with `HOST_PASSWORD`. Home-network phones and the TV need no code (`TRUST_LAN`). Plan
(2026-10-22, approved by the user): five phases, one commit each.

User decisions (2026-10-22):
- Server on the user's machine behind a Cloudflare Tunnel; `ONLINE_URL` = the tunnel address
  (`PUBLIC_URL` stays the LAN address for in-room QR codes, see bugs/public-url-tunnel-breaks-room-qr.md).
- Table code for players; host password from `.env`; no code on the LAN (can be turned off).
- **Push-to-talk to the DM for everyone, including the room**; players talk freely to each other.
- Webcam per player, or the character portrait instead.
- Hidden information is filtered **on the server**.
- P2P WebRTC mesh with public STUN + `ICE_SERVERS` env for TURN.

## Notes
- **Behind the tunnel every request comes from 127.0.0.1.** `CF-Connecting-IP` is how tunnelled
  requests are told apart (general/decisions.md 2026-10-22). `classifyOrigin` (auth/origin.ts):
  CF header → remote; `X-Forwarded-For` → last hop, never more trusted than the peer; a public `Host`
  on a local/lan request → remote (DNS rebinding).
- Access levels host / table / player / none (auth/access.ts). `routeNeed` works on Fastify's
  matched route **pattern**; everything under `/api` is host-only unless allowlisted.
- Revocation = the seat claim: a bound player token is valid only while its `sid` holds the seat
  (auth/token.ts `seatOwner`). Kick and logout release the seat; rotate bumps `gen`.
- Behaviour change: a laptop running `/host` on the LAN now needs `HOST_PASSWORD` + `/login` (the
  LAN is table access). Documented in install-and-run.md and online-play.md.
- Vite dev proxy now uses `xfwd` so the server sees real client addresses in `pnpm dev`.
- Phase 1 review fixes (2026-10-22): rate-limit key from forwarding headers only for a loopback peer;
  IPv6 per /64 and a global budget of 100 failures/10 min; table codes are two words + 4 digits;
  `TRUSTED_HOSTS` for router DNS suffixes; a seat with no socket for 2 min can be taken over; `safeNext`
  resolves like the browser. Bugs: bugs/auth-rate-limit-bypass.md, bugs/safenext-open-redirect.md,
  bugs/public-url-tunnel-breaks-room-qr.md, bugs/router-hostname-treated-as-rebinding.md,
  bugs/stale-seat-claim-locks-player-out.md.
- Still open after phase 1: phones and remote players get the full `GameState` (phase 2).

## TODOs
- [ ] Phase 2: server-side filtering of hidden info. Move the visibility rules to
      `packages/shared/src/visibility.ts`; `projection.ts` `publicState`/`publicCampaign`; Hub viewer
      tier `full` (host/table) vs `public` (player), public payload built once per event; snapshot per
      tier; `docs/server/state-projection.md`.
- [ ] Phase 3: push-to-talk floor (`game/floor.ts`: press/release, first speaker wins, 30 s auto
      release, 600 ms tail, `holderDuring`); `ptt`/`floor` events; floor first in `identifySpeaker` /
      `liveSpeaker`; session gate drops turns no floor covers when `PUSH_TO_TALK` is on; Space on
      `/table`, hold button on phones; the floor enables the room mic track; host toggle.
- [ ] Phase 4: `/play/:playerId` remote page. Split `TablePage` into `table/TableScene.tsx`
      (follow the tv-timing skill), export the sheet parts, PTT button, typed input, local NPC clips;
      `/join` → claim → `/play/:id` (LAN phones keep `/player/:id`).
- [ ] Phase 5: WebRTC mesh (`rtc`/`peers` events relayed by the Hub, `lib/rtc/mesh.ts`, `PeerMesh`),
      DM audio forwarded from `/table`, `table/dmMixer.ts` gain plan feeding `VoiceLink`, video tiles
      with character cards (`call/VideoStrip.tsx`), `docs/web/online-call.md`.
- [ ] Real-world check: `cloudflared tunnel --url http://localhost:8787`, a friend joins with the
      code from another network; `/login` from a LAN laptop (see general/live-test-checklist.md)
- [ ] Visual check of `/login`, `/join` and the Online card with the run-and-screenshot skill (no
      browser in the phase 1 container; the routes were smoke-tested with curl)
- [ ] Dedupe `/api/npc/clip-ended` across several table clients (once `/play` pages play clips)

## Completed
- 2026-10-19: Research and design notes (no code).
- 2026-10-22: Phase 1: authentication and Cloudflare. `apps/server/src/auth/` (origin, token,
  ratelimit, store, access, index), `routes/auth.ts` (`/api/auth/host|join|claim|me|logout`,
  host-only `code/rotate`, `kick`, `sessions`), `onRequest` access hook + CSRF `Origin` check,
  WebSocket upgrade checks (Origin, access, `/ws/audio` table/host) and hello clamp in `Hub`,
  `GET /api/rtc/config`, config `HOST_PASSWORD`/`TABLE_CODE`/`TRUST_LAN`/`HOST_LOCAL_BYPASS`/
  `PUSH_TO_TALK`/`ICE_SERVERS`; web `/login`, `/join`, 401 → sign in (`lib/auth.ts`), `useServer`
  stops retrying when refused, host Party tab **Online** card. Tests: auth/*.test.ts,
  app.auth.test.ts, hub.test.ts, config.test.ts, web lib/auth.test.ts, lib/api.test.ts,
  host/online.test.ts.
- 2026-10-22: Phase 1 adversarial-review fixes (see Notes); `ONLINE_URL`, `TRUSTED_HOSTS`.
