---
title: Configuration (environment variables)
area: setup
topic: config
related_code:
  - apps/server/src/config.ts
  - .env.example
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude
status: current
change_log:
  - "2026-10-22: LOCAL_FORWARDER (every loopback request is remote behind ssh -R/socat-style forwarders)"
  - "2026-10-22: ONLINE_URL's host is always remote; HOST_LOCAL_BYPASS needs a loopback host name"
  - "2026-10-22: Phase 5: ICE_SERVERS links the TURN example"
  - "2026-10-22: PUSH_TO_TALK is live (push-to-talk floor); host toggle"
  - "2026-10-22: ONLINE_URL (tunnel, invite link) apart from PUBLIC_URL (LAN QR codes); TRUSTED_HOSTS; two-word table codes"
  - "2026-10-22: Online play: HOST_PASSWORD, TABLE_CODE, TRUST_LAN, HOST_LOCAL_BYPASS, PUSH_TO_TALK, ICE_SERVERS; PUBLIC_URL is the tunnel address for invites; auth.json in DATA_DIR"
  - "2026-10-21: REALTIME_VAD_EAGERNESS"
  - "2026-10-21: Desktop + laptop note: the mic is allowed in the table tab"
  - "2026-10-21: CONSULT_TIMEOUT_MS (BRAIN_TIMEOUT_MS no longer covers consult_brain), IMAGE_TIMEOUT_MS, HTTPS_PORT/HTTPS_CERT/HTTPS_KEY, VOICE_HANDOVER_AFTER_MS/VOICE_HANDOVER_DEADLINE_MS; desktop server + laptop table"
  - "2026-10-21: NPC_TTS_TIMEOUT_MS"
  - "2026-10-20: AI_PLAYER_PROVIDER, AI_PLAYER_MODEL_OPENAI/ANTHROPIC, AI_PLAYER_TIMEOUT_MS, AI_PLAYER_SPONTANEOUS_COOLDOWN_MS"
  - "2026-10-20: NPC_TTS defaults to on (0/false/no/off turn it off)"
  - "2026-10-20: BRAIN_TIMEOUT_MS covers Anthropic streams"
  - "2026-10-20: BRAIN_TIMEOUT_MS, BRAIN_REASONING_EFFORT, PREPAINT_MAPS"
  - "2026-10-19: PUBLIC_URL"
  - "2026-09-24: Added NPC_TTS and NPC_TTS_MODEL"
  - "2026-09-24: Initial version"
  - "2026-10-18: TURN_GATE and TURN_GATE_TIMEOUT_MS"
  - "2026-10-18: TURN_GATE accepted values, TURN_GATE_TIMEOUT_MS=0"
---

# Configuration

All settings are environment variables, read once in `apps/server/src/config.ts`. The server loads
`.env` from the repo root (`tsx --env-file-if-exists`). Relative paths are resolved from the repo
root.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Realtime voice and text DM, images, and the OpenAI brain |
| `BRAIN_PROVIDER` | `openai` | `openai` or `anthropic` |
| `BRAIN_MODEL_OPENAI` | `gpt-5` | Brain model when using OpenAI (Responses API) |
| `ANTHROPIC_API_KEY` | — | Needed when `BRAIN_PROVIDER=anthropic` |
| `BRAIN_MODEL_ANTHROPIC` | `claude-opus-5` | Brain model when using Anthropic (Messages API) |
| `BRAIN_TIMEOUT_MS` | `900000` | Per brain request (adventure, pregens, sheets, map reading, session recap; not `consult_brain`, see `CONSULT_TIMEOUT_MS`); one retry. The SDK default would wait 10 min × 3. `0` = no limit (capped at setTimeout's ~24.8-day maximum). With Anthropic the whole streamed response must finish within it (`withDeadline`) |
| `CONSULT_TIMEOUT_MS` | `30000` | Per `consult_brain` request (the brain's provider and model; one retry). The voice DM waits on it mid-conversation, so a slow or failed answer becomes the tool result "The planner took too long; improvise from the outline and carry on." instead of a stall. `0` = no limit (capped like `BRAIN_TIMEOUT_MS`), junk uses `30000` |
| `BRAIN_REASONING_EFFORT` | unset | OpenAI reasoning effort for brain calls (`minimal`/`low`/`medium`/`high`); only for reasoning models (a non-reasoning model such as gpt-4o rejects it). Lower is faster |
| `REALTIME_MODEL` | `gpt-realtime` | Voice DM model (e.g. a newer `gpt-realtime-*` when available) |
| `REALTIME_VOICE` | `cedar` | DM voice (Realtime voices such as `marin`, `cedar`, `ash`, `sage`…) |
| `VOICE_HANDOVER_AFTER_MS` | `3000000` | Planned silent handover of the Realtime call: after this call age (50 min) the server waits for a quiet moment at the table and swaps to a fresh call without a greeting (see [realtime-sideband](../server/realtime-sideband.md)). OpenAI caps a call at 60 min |
| `VOICE_HANDOVER_DEADLINE_MS` | `3420000` | Call age (57 min) at which the handover is forced (as soon as the DM isn't speaking), before OpenAI's 60-minute cap ends the call |
| `TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | Transcribes player speech for the host log |
| `TURN_GATE` | on | Noise-turn gate: hold the reply to a voice turn until its transcript arrives and skip turns that are only coughs or fillers. `off`, `false`, `0`, `no`, `disabled` or `none` (any case) answers on commit (lower latency); anything else is on |
| `REALTIME_VAD_EAGERNESS` | `low` | How soon a pause ends a player's turn (semantic VAD): `low`, `medium`, `high` or `auto`; anything else is `low`. `low` waits longest so slow talkers aren't answered mid-sentence. Raise it if replies feel sluggish; check the `[cutoff]` and `gap=` diagnostics |
| `TURN_GATE_TIMEOUT_MS` | `1200` | Gate timeout: answer anyway when no transcript arrived by then. `0` is allowed (answer as soon as the transcript or nothing arrives on the next tick), negatives become `0`, junk uses `1200`. Tune it from the `[turn-timing]` server log lines |
| `NPC_TTS` | on | The `speak_as_npc` tool: the DM voices every quoted NPC line in that NPC's own voice, played on `/table`. On when unset, empty or any other value; `0`/`false`/`no`/`off` turn it off. Needs `OPENAI_API_KEY` (`.env.example` sets `NPC_TTS=1`) |
| `NPC_TTS_MODEL` | `gpt-4o-mini-tts` | Speech model for `speak_as_npc` (must support `instructions`); AI players speak with it too |
| `NPC_TTS_TIMEOUT_MS` | `15000` | Time limit for one speech request (one retry; the whole synthesis is cut off at 2×). A slow clip fails, and the DM speaks the NPC line or gets the AI player's line as text |
| `AI_PLAYER_PROVIDER` | `BRAIN_PROVIDER` | [AI players](../gameplay/ai-players.md): `openai` or `anthropic` |
| `AI_PLAYER_MODEL_OPENAI` | `gpt-5-mini` | AI player model on OpenAI (reasoning effort `low`) |
| `AI_PLAYER_MODEL_ANTHROPIC` | `claude-haiku-5-5` | AI player model on Anthropic |
| `AI_PLAYER_TIMEOUT_MS` | `20000` | Per AI player decision (one retry) |
| `AI_PLAYER_SPONTANEOUS_COOLDOWN_MS` | `90000` | Least time between two unprompted AI player lines |
| `IMAGE_MODEL` | `gpt-image-1` | Maps and sprites |
| `IMAGE_QUALITY` | `medium` | `low` / `medium` / `high` (cost vs detail) |
| `IMAGE_TIMEOUT_MS` | `300000` | Time limit for one image request, its one retry included (the request is aborted). A stalled image fails its job chip with "Image request timed out after 300s." instead of hanging. `0` = no limit (capped), junk uses `300000` |
| `PREPAINT_MAPS` | on | When the party arrives somewhere, paint the next outline location's map in the background (one at a time) so the next arrival doesn't wait. Needs an image key; each prepaint also reads the map's features (a brain call). `0`/`false`/`off` disables (saves image and brain calls) |
| `SPEAKER_MODEL` | `models/wespeaker_en_voxceleb_resnet34.onnx` | sherpa-onnx speaker embedding model |
| `SPEAKER_THRESHOLD` | `0.45` | Minimum cosine score for a confident speaker match |
| `PORT` | `8787` | HTTP and WebSocket port (Vite's proxy uses it too) |
| `HTTPS_PORT` | `8443` | Second listener over HTTPS with the same routes, `/ws` and `/ws/audio`, sharing one game. Browsers only allow the microphone on https or `localhost`, so a laptop running `/host` against another machine needs it. `0` turns it off; junk or out of range uses `8443`. If it can't start (port taken, bad cert) the server warns and keeps running on `PORT` |
| `HTTPS_CERT` | empty | Path to your own certificate (PEM, e.g. from mkcert). Used only together with `HTTPS_KEY`; one alone is ignored with a warning |
| `HTTPS_KEY` | empty | Path to the matching private key (PEM). Without both, a self-signed certificate is made in `DATA_DIR/certs/` (SANs: `localhost`, `127.0.0.1` and every LAN IPv4) and remade when a new LAN address appears or it nears expiry |
| `PUBLIC_URL` | empty | Base URL phones should open, e.g. `http://192.168.1.20:8787` (no `/player`). Used for the player link, the per-player QR codes on the host and the join QR on the TV. Empty = the laptop's first LAN IPv4 on `PORT` (pages opened over the LAN use their own address). Also an accepted `Origin` and hostname. **Not the tunnel address**: a phone that came through the tunnel is remote and needs the code; use `ONLINE_URL` |
| `DATA_DIR` | `campaigns` | SQLite database, generated images, NPC voice clips, the self-signed HTTPS certificate (`certs/`) and the sign-in state (`auth.json`: cookie secret, table code, seat claims) |

## Online play

See [online play](online-play.md) and [authentication](../server/auth.md).

| Variable | Default | Purpose |
|---|---|---|
| `ONLINE_URL` | empty | The Cloudflare Tunnel's https address (e.g. `https://dnd.example.com`, trailing `/` dropped): the Online card's invite link and the startup log use it; an accepted `Origin`. A request addressed to its host is always remote, even from 127.0.0.1 (a local proxy without forwarding headers), so don't use the same name for `PUBLIC_URL`. In-room QR codes keep using `PUBLIC_URL` / the LAN IP |
| `TRUSTED_HOSTS` | empty | Extra home-network host names, comma-separated, lower-cased (a router's DNS suffix such as `fritz.box`; covers subdomains). A LAN request to any other dotted public-looking name is treated as DNS rebinding (remote) |
| `HOST_PASSWORD` | empty | Host sign-in at `/login` from any other machine (trimmed). Empty = the host screen works only on the server machine. Changing it signs every host out |
| `TABLE_CODE` | empty | The code remote players type at `/join`. Empty = one like `WOLF-RUNE-7342` is made once, kept in `DATA_DIR/auth.json` and rotated from the Online card. Set = fixed (no Rotate); changing it signs every player out at the next start |
| `TRUST_LAN` | on | Home-network callers (private, link-local and ULA addresses) get table access and any seat without a code, as before auth. `0`/`false`/`no`/`off` = they need the code too |
| `LOCAL_FORWARDER` | off | `1`/`true`/`yes`/`on`: a forwarder on this machine adds no `X-Forwarded-For` (`ssh -R`, socat, nginx without it) and passes the caller's own `Host` through, so `Host: localhost` from the internet would get `HOST_LOCAL_BYPASS`. On, every request from 127.0.0.1 is remote and this machine signs in like everyone else. Not needed for cloudflared or a proxy that sets `X-Forwarded-For` |
| `HOST_LOCAL_BYPASS` | on | A browser on the server machine, opened as `localhost` (or `127.0.0.1`, `[::1]`), is the host without the password. Tunnelled requests (`CF-Connecting-IP`), `ONLINE_URL`'s host, and this machine under another name (`gamebox.local`, the LAN IP) never get it. Off = this machine is treated like the LAN |
| `PUSH_TO_TALK` | on | Everyone, the room included, holds a button to talk to the DM (Space on `/table`, **Hold to talk** on phones); voice turns nobody held the floor for are dropped. Off: open mic as before. The host can toggle it while playing. See [push-to-talk](../server/realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts) |
| `ICE_SERVERS` | Cloudflare + Google public STUN | WebRTC servers for player video and voice, as a JSON array of `{urls, username?, credential?}`. Add a TURN server when video can't connect between two homes (example in [online play](online-play.md#6-video-and-voice-stun-turn-and-ice_servers); the media is peer to peer, never through the tunnel). Invalid JSON logs a warning and uses the default. Served at `GET /api/rtc/config` |

## Desktop server + laptop table

Run the server on a desktop and use a laptop as the host controls and TV: keep `HTTPS_PORT=8443`,
open `https://<desktop-ip>:8443/host` and `/table` on the laptop, accept the certificate warning
once, then allow the mic (in the table tab, which carries the voice call). Phones keep joining over `http://<desktop-ip>:8787/player` (no warning).
See [install-and-run](install-and-run.md#desktop-server--laptop-table).

Model names change often. Check the provider's model list and override these defaults instead of
editing code.
