# Feature: Online / remote play (keeping voice input)
Status: planned
Docs: docs/architecture/data-flow.md, docs/server/realtime-sideband.md, docs/server/speaker-id.md

## Overview
Let a group play over the internet instead of around one table, still talking to the voice DM.
Research only so far (2026-10-19); no code. Intended for a future branch.

Today everything assumes one room and one mic:
- Since 2026-10-21 `/table` owns the call (`apps/web/src/table/useTableVoice.ts`): one
  `getUserMedia` (`apps/web/src/lib/voice.ts` `getTableMic`) feeds both the browser WebRTC call to
  OpenAI Realtime (`VoiceLink`, server creates the call via `/api/dm/voice` + sideband WS) and
  `MicStreamer("table")` → `/ws/audio?role=table` (16 kHz PCM16 → `AudioRing` for voiceprint ID and
  `LiveTalk`). `/host` only sends commands, plus its own `/ws/audio?role=host` stream while a voice
  is being enrolled (see general/decisions.md 2026-10-21).
- DM voice plays only in the `/table` tab (WebRTC). Echo cancellation works because playback and
  mic are in the same tab.
- Speaker ID infers who spoke from one mixed signal: host tap → only player → voiceprint
  (`GameService.identifySpeaker`, `game/service.ts`).
- Phones (`/player/:id`) never capture audio.

## Notes
### 1. Exposure and security (needed for any variant)
- HTTPS is mandatory: `getUserMedia` needs a secure origin. The server already has an HTTPS
  listener on `HTTPS_PORT` (8443) with an auto self-signed cert (`apps/server/src/tls.ts`,
  `HTTPS_CERT`/`HTTPS_KEY` override; decisions.md 2026-10-21), which covers a LAN. Over the
  internet use a reverse proxy/tunnel (Caddy, Cloudflare Tunnel, Tailscale Funnel) with a real
  certificate and set `PUBLIC_URL`. `MicStreamer` already picks `wss` on https.
- There is no auth at all. The server listens on `0.0.0.0` and every route is open: campaign
  reset/delete, `/api/tools/:name`, `/api/dm/voice` (spends the OpenAI key), image generation,
  `/ws`, `/ws/audio`. Needed:
  - host login (session cookie)
  - a signed per-player token in join links/QR; `/api/players/:id/*` checks it
  - authenticated WS upgrades (`apps/server/src/index.ts` upgrade handler)
  - rate limits on endpoints that cost money

### 2. Audio architecture (the big change)
Realtime takes ONE input audio stream per session, so remote mics must be combined somewhere.

Recommended: the server becomes the audio hub.
- Each remote client captures its own mic and streams PCM to the server (reuse the `voice.ts`
  worklet; e.g. per-player `/ws/audio?player=…`).
- The server mixes the streams and sends them to Realtime with `input_audio_buffer.append`. Voice
  mode moves from browser WebRTC to a server-side WebSocket session (text mode already works this
  way, so `DmSession` is most of the way there).
- DM audio: the server takes `response.output_audio.delta` chunks and broadcasts them to all
  clients, which play them through a small jitter buffer.
- Speaker ID by channel: the server knows which channel had energy in the turn's `[t0, t1]`, so
  "channel attribution" goes first in `identifySpeaker`; voiceprints become a fallback (e.g. two
  people on one device in a hybrid game). One `AudioRing`, `LiveTalk` level and mute flag per channel.
- `output_audio_buffer.started/stopped/cleared` are WebRTC-only. They drive the `speaking` status,
  the NPC clip queue's "DM is silent" check, and `stopTalking` (`realtime/session.ts` ~473,
  ~570–579). Replace with server-tracked playback state (time since last audio chunk, or clients
  reporting playback ended). `stopTalking` must stop the fan-out, flush client buffers and send
  `conversation.item.truncate`.
- Echo: each player's mic picks up the DM from their own speakers. Audio played via WebSocket +
  WebAudio may not be cancelled reliably by the browser's AEC. Recommend headphones, or send DM
  audio over WebRTC.
- Players need to hear each other too. Either assume Discord alongside (simplest; fine with
  headphones) or build player-to-player voice.

Alternatives considered:
- SFU (LiveKit cloud/self-hosted): both directions, player-to-player voice, per-participant
  tracks, better latency than WS audio; LiveKit Agents already integrates OpenAI Realtime. Cost:
  replaces most of the transport in `realtime/session.ts` and `voice.ts`.
- Zero-code hack: everyone on Discord; host routes call audio + own mic into the "table mic" via a
  virtual audio cable and shares DM output back into the call. Voiceprints degrade under Discord's
  compression. OK for a quick test only.

### 3. Smaller multi-client fixes
- Everyone opens `/table` (or a merged table + player view); `Hub` already broadcasts to all sockets.
- `/api/npc/clip-ended` would arrive N times. `npcClipEnded` should accept the first per URL, or
  the server should time clips itself.
- Mute: the hard table mute (`/api/mic`, disables the host track) becomes per-player mute plus a
  host "mute all".
- Voice enrollment (`/api/players/:id/enroll/*`) is driven from the host laptop; it would need to
  record the player's own channel, or be skipped once channel attribution exists.
- Physical dice become an honor system; the phone number pad already covers it.

### 4. Hosting
Server runs the ONNX speaker model on CPU and uses SQLite; a small VPS or own machine behind a
tunnel is fine. One active campaign per server suits one group. Realtime cost stays about the same
(still one session).

## TODOs
- [ ] Phase 1: auth (host login, signed player tokens, WS auth, rate limits; HTTPS listener exists). Lets the
      current single-mic setup run over a LAN or Tailscale safely.
- [ ] Phase 2: per-player mic streams to the server; channel-based speaker attribution in
      `identifySpeaker`; per-channel `AudioRing`/`LiveTalk`/mute.
- [ ] Phase 3: server-side Realtime voice session (WS, `input_audio_buffer.append`), DM audio
      fan-out with client jitter buffer, rework speaking/NPC-clip/`stopTalking` playback state.
- [ ] Dedupe `/api/npc/clip-ended` across multiple table clients.
- [ ] Decide echo strategy (headphones requirement vs WebRTC DM audio).
- [ ] Optional Phase 4: SFU (LiveKit) or built-in player-to-player voice.

## Completed
- 2026-10-19: Research and design notes (no code).
