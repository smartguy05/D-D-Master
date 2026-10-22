---
title: Online call (WebRTC mesh, webcams, character tiles)
area: web
topic: online-call
related_code:
  - apps/web/src/call/**
  - apps/web/src/lib/rtc/**
  - apps/web/src/table/dmMixer.ts
  - apps/web/src/table/dmMixer.test.ts
  - apps/server/src/rtcRelay.ts
  - apps/server/src/rtcRelay.test.ts
  - packages/shared/src/rtc.ts
  - packages/shared/src/rtc.test.ts
created: 2026-10-22
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Members whose seat is gone leave the call (recheckSeats); the mute toggle is toward remote players only"
  - "2026-10-22: Initial version (online play phase 5: rtc/peers signaling relay, PeerMesh, DM mixer, DM voice forward, VideoStrip tiles)"
  - "2026-10-22: Review fixes: per-link signal budget, rtc_join throttle, kicked sockets leave at once, replaceStream during handover unmute, /play tail via tailAfter"
---

# Online call (WebRTC mesh, webcams, character tiles)

Remote players ([online play](../setup/online-play.md)) and the room talk and see each other in a
small **peer-to-peer WebRTC call**. The server only relays signaling over `/ws`; audio and video go
directly between browsers (STUN from `ICE_SERVERS`, add TURN there when two homes can't connect).
Media never passes through the server or the Cloudflare tunnel.

Members:
- **the room**: the `/table` TV (one screen: the one carrying the voice DM, else the first to join);
- **remote players**: each `/play/:playerId` page outside the home network, at most
  `MAX_REMOTE_PEERS` (5).

Home-network `/player` phones never join (they are in the room), and neither does `/host`.

## What flows where

| From → to | Mic (slot `mic`) | DM voice (slot `dm`) | Camera (slot `cam`) |
| --- | --- | --- | --- |
| room → each remote player | a second capture of the room mic, always on toward the players (own-tile 🎙 mutes it) | the OpenAI Realtime audio track from `VoiceLink` (nothing else: NPC clips are `<audio>` elements and never enter it) | optional TV webcam (off by default) |
| remote player → room and every other player | their mic, unless muted toward the players | — | their webcam unless off or "character instead" |

- `/table` plays every remote voice out of the TV, so the room hears them, and feeds them to the DM
  mixer (below).
- `/play` plays the room's mic, the DM's voice and the other players through `<audio>` elements.
  `npc_speech` clips still play locally from their URLs (phase 4, `useServer` `playClips`), so they
  are heard once.
- A remote player muted toward the players still reaches the room (and so the DM) while they hold the
  push-to-talk floor, plus `FLOOR_TAIL_MS` (`slotTrack`, `holdsOwnFloor`).

## Signaling (server: `apps/server/src/rtcRelay.ts`)

ClientEvents over `/ws`:
- `{type:"rtc_join", prefs:{camera, showCharacter, micOn}, playerId?}`: join, or update the prefs.
- `{type:"rtc_leave"}`.
- `{type:"rtc", to, signal}`: `signal` is `{description:{type: offer|answer|rollback, sdp?}}` or
  `{candidate: {...} | null}`.

ServerEvents, sent only to members:
- `{type:"peers", self, peers: PeerInfo[], refused?}`: `self` is this socket's peer id, or null when
  it isn't in the call, with the reason in `refused`.
- `{type:"rtc", from, signal}`.

`RtcRelay` (wired in `GameService`; the socket's role, access and origin come from the `Hub`):
- **The room** is a socket whose hello is `table` with table or host access. Several tables queue;
  the one `GameService` names as the voice owner (`setRoomOwner`, on every `voice_owner` broadcast)
  becomes the room, else the first. A new room screen gets a new peer id (`r<n>`), so remote pages
  build a fresh connection to it.
- **A remote player** is a `player` socket from outside the home network (`Hub.inRoom` false). A
  player cookie joins only as its bound seat (a `playerId` in the event is ignored). Only host or
  table access may name a seat. The seat must be a human player of the loaded campaign. A second
  page for the same seat replaces the first (it gets `refused`). A sixth remote player is refused.
- **Relay**: only from a member to another member, never to itself, and only a payload that passes
  `rtcSignal` (`packages/shared/src/rtc.ts`: known fields, SDP ≤ `RTC_SIGNAL_MAX_CHARS`, candidate ≤
  1 KB). At most `RTC_RATE_MAX` (120) signals per link (sender and target) per 10 s, so the room
  opening all five links at once still gets its last (TURN relay) candidates through. At most
  `RTC_JOIN_MAX` (20) `rtc_join` per socket per 10 s, and a join that changes nothing sends no `peers`.
- The Hub drops any client message over `HUB_MESSAGE_MAX_CHARS` (64 KB) before parsing it, and
  `/ws` has `maxPayload` 256 KB.
- A socket that closes (or is kicked) leaves the call. A kick or code rotation (`Hub.closeWhere`)
  tells the close listeners at once and ignores the socket's later frames, so it leaves the call
  without waiting for the close handshake. `peers` and `rtc` carry no game state, so the
  public projection passes them unchanged (`Hub.send`).

## The mesh (client: `apps/web/src/lib/rtc/`)

- `mesh.ts` (pure, `mesh.test.ts`): `meshDiff` (open one connection per other member, close the rest),
  `isPolite` (peer id order, the same answer on both pages), `SLOTS` / `slotOf`, `slotTrack` (what
  each slot sends toward one member), `holdsOwnFloor`, `videoEncoding` (360 lines, 300 kbps).
- `peerMesh.ts` (`PeerMesh`, thin glue): one `RTCPeerConnection` per pair with **perfect
  negotiation**.
  - The impolite side adds three `sendrecv` transceivers in `SLOTS` order (mic, dm, cam). The polite
    side gets the same three from the offer and sets them to `sendrecv` before answering.
  - Both pages know a track's slot from its transceiver index, and tracks change only with
    `replaceTrack`, so there is no renegotiation.
  - Signals for one connection are handled in order (a queue).
  - The impolite side calls `restartIce()` when a connection fails.
  - The camera sender gets `maxBitrate` / `scaleResolutionDownBy` through `setParameters`.
- `call/useCall.ts`:
  - gets `GET /api/rtc/config`, makes the mesh, and joins once `/ws` is up (again after a reconnect);
  - opens the mic (`/play` at once, `/table` once a remote member exists) and the camera (640×360
    ideal, 24 fps max);
  - on `/table` passes the DM track along;
  - tells the server `camera: true` only while a camera track exists.
- `useServer` routes `peers` / `rtc` to `onPeers` / `onRtc`. A closed `/ws` reads as "not in the
  call", which closes every connection; the page joins again after the reconnect.

## Audio into the DM (`apps/web/src/table/dmMixer.ts`)

What the voice DM hears from `/table`:

- **No remote player in the call:** the room mic itself, exactly as before. No WebAudio is involved.
- **With remote players:** `DmMixer`, an `AudioContext` graph. The room mic and each remote voice go
  into a `MediaStreamDestination`, which `VoiceLink.replaceStream` sends instead (switched by
  `sendMixed`).
  - The room mic is still gated on its track (push-to-talk floor + tail, mute; `tableMicEnabled`).
  - Each remote voice has its own gain (`gainPlan`): 1 only while that player holds the floor from
    outside the room, plus the `FLOOR_TAIL_MS` tail (`remoteTail`), 0 otherwise.
  - With push-to-talk off, every voice is open. The table mute silences all of them.
- **The output stream is made once**, so a reconnect, a resume and the planned handover (which re-add
  this stream's track, or mute the standby with `replaceTrack(null)` and unmute it at the swap) work
  as before.
  - `replaceStream` swaps the live call's senders. A pending standby unmutes with the stream that is
    current at the swap.
- **Chrome quirk.** A remote WebRTC track feeds WebAudio only while a media element plays it.
  `DmMixer` attaches each remote stream to its own muted `<audio>` (`attachSink`).
- **Autoplay.** The graph is built only when the first remote voice arrives. If its context is
  suspended (nobody clicked the TV yet), the call keeps the room mic and the TV asks for a click
  (`markAudioLocked`). The click resumes it (`onAudioLockChange` → `DmMixer.resume`), and the call
  switches to the mix.
- Voice ID (`MicStreamer`) still gets only the raw room mic. Remote players are identified by the
  floor (`identifySpeaker` puts the floor holder first) and need no voice enrollment.

## The DM's voice to remote players

`VoiceLink.onRemoteStream` reports the call's remote stream: on a new call, at the handover swap
(the standby's audio), and `null` at hang-up. `useTableVoice` returns its audio track as `dmTrack`,
and the room's mesh puts it on the `dm` slot toward every remote player. `/play` plays it.

## Tiles (`apps/web/src/call/VideoStrip.tsx`, `tiles.ts`, `levelMeter.ts`, `call.css`)

- `/table`: a side strip at the bottom left of the map, only while a remote player is in the call.
  An in-room game looks as before.
- `/play`: a row along the bottom of the map. On narrow screens it is smaller and runs the full
  width.
- `tileView` (pure) builds each tile:
  - video when the member's camera is on air and a live video track arrived;
  - else the character card: `Character.spriteUrl`, or the color dot for a seat without a sprite, a
    🎲 dot for the room;
  - the name, an HP bar and conditions.
  - The room tile is "The table".
- **Talking ring**: a local `LevelMeter` (one `AnalyserNode` per voice, `levelOf` RMS, `nextTalking`
  hysteresis, polled every 120 ms).
- **Gold ring**: the floor holder's tile. For the room or an in-room player, that is the room tile.
- **Own-tile toggles**: 📷 camera, 🧙 character instead (`/play` only), 🎙/🔇 mute toward the players.
  The mute is toward other remote players only: while that player holds talk-to-the-DM, the TV still
  plays their voice to the room (in-room push-to-talk is audible to everyone anyway).
- **Seats that disappear**: `RtcRelay.recheckSeats()` runs on every state commit, campaign load and
  campaign delete; a remote member whose seat no longer exists gets `peers {self: null, refused}`
  and leaves the call.
  They are saved per device in `localStorage` (`dm.call.play` / `dm.call.table`;
  `loadCallPrefs` / `saveCallPrefs` wrap storage in try/catch).
  - Defaults: `/play` camera on, `/table` camera off.
- Autoplay: a refused `<audio>` calls `markAudioLocked`. The page's "Click to…" button retries
  it. On `/play` the button also shows while the call has audio, even with table sounds muted (M).

## Verified in headless Chromium (2026-10-22)

Setup:
- two `/play` contexts, each behind a small proxy that adds `CF-Connecting-IP` (a stand-in for
  cloudflared: Playwright's `extraHTTPHeaders` don't reach the WebSocket upgrade);
- one `/table` context;
- `--use-fake-device-for-media-stream`.

What was checked:
- All six connections of the three-member mesh reached `connected` (about 9 s in the sandbox, which
  has no STUN access).
- Remote 640×360 video played on the TV and on the other `/play` page.
- Audio bytes arrived both ways.
- Talking rings followed the fake mic beeps.
- "Character instead" and "mute toward players" showed the card and 🔇 on the other pages and were
  saved in `localStorage`.
- A held Space on `/play` put the gold ring on that tile on the TV.

Not verified (needs an OpenAI key or real hardware):
- the DM hearing a remote holder through the mixer;
- remote players hearing the DM's voice forward;
- echo in a real room;
- two real home networks (TURN).
See `.memories/general/live-test-checklist.md`.

## Known limits

- The room mic toward remote players is a second capture of the same device. The TV plays remote
  voices out loud, so the room relies on Chrome's echo cancellation. With loud TV speakers, remote
  players may hear the DM twice: the forward plus the room mic's echo.
- The table mute (P) stops the DM hearing the room. It doesn't mute the room toward remote players;
  the room tile's 🎙 does.
- A full mesh of 6 sends up to 5 video streams from each page (about 1.5 Mbit/s up at 300 kbps).
  That's fine for a home connection, not for a weak phone.
- Muted toward the players with push-to-talk off, a remote player can't reach the DM: there is no
  floor to route their voice to the room.

## Tests

- `packages/shared/src/rtc.test.ts`: payload check and prefs.
- `apps/server/src/rtcRelay.test.ts`: room and seats, refusals, relay rules, rate limit, the limit
  of 5, seat replacement, room hand-over, per-link ICE burst, join throttle.
- `apps/server/src/app.auth.test.ts`: the call over a real `/ws` (TV, remote page, LAN phone); the
  room follows the voice owner (`GameService.broadcastVoiceOwner` -> `rtc.setRoomOwner`).
- `apps/server/src/hub.test.ts`: oversized message dropped; `closeWhere` closes at once.
- `apps/web/src/lib/rtc/mesh.test.ts`, `apps/web/src/table/dmMixer.test.ts` (gain plan, tail,
  `sendMixed`, fake WebAudio graph), `apps/web/src/call/tiles.test.ts`.
- `apps/web/src/lib/voice.test.ts`: `onRemoteStream` and `replaceStream` across reconnect and
  handover, including a swap during the handover's unmute.
