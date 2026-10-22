# Feature: Online / mixed play (room + remote players)
Status: in-progress (phases 1-4 of 5 done)
Docs: docs/setup/online-play.md, docs/web/remote-play.md, docs/server/auth.md, docs/server/state-projection.md, docs/server/realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts, docs/server/http-api.md, docs/setup/configuration.md

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
- Phase 2 (server-side filtering): viewer tier = access + clamped hello role (player cookie or hello
  `player` → public; hello `host`/`table` → full). Host/table sockets get their snapshot after the
  hello. `PublicFeed` builds each public event once per broadcast and re-sends the public campaign
  before a state that reaches a new location. Decisions in general/decisions.md (2026-10-22, phase 2).
  Bugs: bugs/public-campaign-judged-on-old-campaign-state.md, bugs/phone-roll-reply-leaks-target-ac.md.
- Phase 3 (push-to-talk): the floor lives in `GameService` (`game/floor.ts`; cleared on push-to-talk toggle and campaign switch/reset/delete via `resetFloor`), so live and standby
  sessions share it; `inRoom` comes from the pressing socket's origin (`Hub.inRoom`: local/lan),
  not its access level, so with `TRUST_LAN` off a home phone signed in with the code still opens the
  room mic (bugs/ptt-in-room-by-access-level.md).
  Releasing doesn't end the turn: the VAD still waits for silence; the tail + overlap check cover it.
  Decisions in general/decisions.md (2026-10-22, phase 3). Bugs: bugs/ptt-auto-release-not-announced.md, bugs/ptt-enrollment-mic-closed.md,
  bugs/ptt-talk-button-stuck.md, bugs/ptt-in-room-by-access-level.md. Review hardening: per-socket
  press throttle (`PTT_MIN_GAP_MS`, 250 ms, releases never throttled) and host `POST
  /api/floor/release` (`freeFloor`, **Free the floor** in the Play tab). Phase 4's `/play` page reuses
  `player/TalkButton.tsx` and `lib/floor.ts` (Space via `isTalkKey`). Phase 5's `dmMixer` gain plan
  should take the floor (`FloorView`) and `FLOOR_TAIL_MS` from @dm/shared.
- Phase 4 (`/play`): `TablePage` split into `table/TableScene.tsx` (`useTableScene` + `TableScene`,
  page slots keep the TV's DOM order). The projected state is handled: `turnIndex: -1` →
  `HIDDEN_TURN` (held like any turn, "Unknown foe"), no monster AC shown anywhere, secret rolls throw
  no dice and the toast shows only "?" (`rollToastView`), only visited locations needed. Decisions in
  general/decisions.md (2026-10-22, phase 4). Bug: bugs/secret-roll-toast-shows-dice.md.

## TODOs
- [ ] Phase 5: WebRTC mesh (`rtc`/`peers` events relayed by the Hub, `lib/rtc/mesh.ts`, `PeerMesh`),
      DM audio forwarded from `/table`, `table/dmMixer.ts` gain plan feeding `VoiceLink`, video tiles
      with character cards (`call/VideoStrip.tsx`), `docs/web/online-call.md`.
- [ ] Real-world check: `cloudflared tunnel --url http://localhost:8787`, a friend joins with the
      code from another network; `/login` from a LAN laptop (see general/live-test-checklist.md)
- [ ] Visual check of `/login`, `/join` and the Online card with the run-and-screenshot skill (no
      browser in the phase 1 container; the routes were smoke-tested with curl)
- [ ] Live check: hidden ambusher and secret roll absent from a remote and a LAN phone's `/ws`
      frames, TV timing unchanged, phone map appears on a new location (see general/live-test-checklist.md)
- [ ] Dedupe `/api/npc/clip-ended` across several `/table` clients (`/play` pages play clips but
      never report, so they don't add to this)
- [ ] Phase 5: the DM's voice to `/play` (forwarded from `/table`) and the remote holder's audio into
      the DM (`dmMixer`); maybe stream DM captions to `/play` outside NPC focus (today only the log line
      at the end of each reply reaches the transcript)
- [ ] Live check of `/play` through a real tunnel (see general/live-test-checklist.md)
- [ ] Live check: push-to-talk in the room (Space on the TV, a LAN phone's button, side chatter and
      TV bleed dropped, the tail long enough) (see general/live-test-checklist.md)
- [ ] Visual check of the TV push-to-talk banner, the phone hold button, the host toggle and the
      **Free the floor** button with the run-and-screenshot skill (not done in the phase 3 container)
- [ ] Live check: enroll a voice from the table mic with push-to-talk on (no `/host` mic stream)
- [ ] Maybe: end the turn on release (`input_audio_buffer.commit` over the sideband) instead of
      waiting for the VAD; needs a live test that a manual commit works with semantic VAD on WebRTC

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
- 2026-10-22: Phase 2: server-side filtering of hidden info. Visibility rules moved to
  `packages/shared/src/visibility.ts` (web re-exports); `packages/shared/src/projection.ts`
  (`publicState`, `publicCampaign`, `publicRoll`, `visitedLocations`, `hiddenCreatureIds`);
  `apps/server/src/publicFeed.ts` (`viewerTier`, `PublicFeed`, `publicSnapshot`, `seatRollReply`);
  Hub tiers and per-tier snapshots; phone roll replies trimmed below the host;
  `docs/server/state-projection.md`. Tests: projection.test.ts, publicFeed.test.ts, hub.test.ts,
  app.auth.test.ts (player vs host socket over real /ws, roll reply).
- 2026-10-22: Phase 2 adversarial-review fixes: attack rolls / pending attacks no longer carry the
  target's AC to players (bugs/projection-leaks-attack-target-ac.md); `unseen` tag on rolls and roll
  log lines keeps a removed hidden creature anonymous (bugs/projection-hidden-roller-unmasked-after-removal.md);
  `publicLogEntry` shared by `publicState` and the `log` event.
- 2026-10-22: Phase 3: push-to-talk floor. `apps/server/src/game/floor.ts` (first press wins, 30 s
  auto release, 600 ms tail, `holderDuring` by overlap, `covered`); `ptt` ClientEvent and `floor`
  ServerEvent (`FloorView`, `FLOOR_TAIL_MS`, `FLOOR_MAX_HOLD_MS` in @dm/shared); `GameService.onPtt`
  seat checks via `Hub.accessOf`, release on socket close, `setPushToTalk` + `POST /api/push-to-talk`
  (host), floor in the snapshot; floor holder first in `identifySpeaker` / `liveSpeaker`; session gate
  `DmHost.outsideFloor` drops uncovered turns (`[ptt]` line); `onUserSpeech` ignores speech outside the
  floor; web `lib/floor.ts`, `useTableVoice` room mic gate with tail, Space on `/table` + banner,
  `player/TalkButton.tsx`, host Play tab toggle. Tests: floor.test.ts, service.floor.test.ts,
  session.test.ts (gate), service.voice.test.ts (live line), app.auth.test.ts (route + real /ws seat
  check), hub.test.ts (`accessOf`), publicFeed.test.ts, web lib/floor.test.ts.
- 2026-10-22: Phase 3 review fixes: table mic open while enrolling (`FloorView.enrolling`),
  `TalkPress` resets when push-to-talk goes off, `inRoom` by socket origin, per-socket ptt throttle,
  host `POST /api/floor/release` + Free the floor button. Tests in lib/floor.test.ts,
  service.floor.test.ts, hub.test.ts, app.auth.test.ts, access.test.ts.
- 2026-10-22: Phase 4: remote player page `/play/:playerId` (`play/PlayPage.tsx`, `play/play.css`):
  shared `table/TableScene.tsx` scene, sheet drawer (`Sheet`/`DraftCard` exported from PlayerPage;
  `sheetAttention` opens it for a physical roll), push-to-talk button + Space on one `TalkPress`
  (`seatTalkPress`), typed input to `POST /api/dm/say` (`sayText`), transcript from the log
  (`transcriptLines`), NPC clips without reporting (`useServer` `playClips`), mute (M); `/join`
  lands remote players on `/play` (`seatPage`); `liveTurnId`/`HIDDEN_TURN`; secret roll toast fix.
  Tests: table/rollToast.test.ts, table/nowPanel.test.ts, play/transcript.test.ts,
  play/playView.test.ts, lib/auth.test.ts. Screenshots of /table and /play side by side on the demo
  campaign (exploration, combat, secret roll, hidden turn, sheet drawer, phone width, Space ptt).
- 2026-10-22: Phase 4 review fixes: `/api/dm/say` caps text on the server (shared `say.ts`
  `SAY_MAX`/`sayText`), throttles seat-bound callers (`SAY_MIN_GAP_MS`, 429) and refuses typing over
  another floor holder (409); `TalkPress` holds per source so the button and Space can't release
  each other; `isTypingTarget` moved to `lib/floor.ts` (used by `isTalkKey`); the party-split
  `sheetAttention` test now covers the focus guard. Bugs: dm-say-unbounded,
  talk-press-sources-release-each-other.
