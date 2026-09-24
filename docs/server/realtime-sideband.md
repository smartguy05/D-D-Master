---
title: Realtime voice DM and sideband
area: server
topic: realtime
related_code:
  - apps/server/src/realtime/**
  - apps/web/src/lib/voice.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Sideband auto-reconnect with backoff, idle warning, VoiceLink reconnect + resume, NPC voice direction and speak_as_npc"
  - "2026-09-24: Initial version (GA Realtime API, openai SDK v7)"
---

# Realtime voice DM and sideband

Files: `apps/server/src/realtime/session.ts`, `instructions.ts`, and the browser side
`apps/web/src/lib/voice.ts`.

## Call setup (WebRTC + sideband)

- `createVoiceCall(host, offerSdp)` calls `client.realtime.calls.create({ sdp, session })` in the
  openai SDK v7. It sends a multipart POST to `/v1/realtime/calls` with an `sdp` part and a
  `session` JSON part.
- The response body is the SDP answer. The call id is the last path segment of the `Location` header.
- `DmSession.connect()` in voice mode opens `wss://api.openai.com/v1/realtime?call_id=<id>`, with
  `Authorization: Bearer OPENAI_API_KEY`. The `model` is ignored, since it was already set on the call.
- In text mode it opens `?model=<REALTIME_MODEL>` and sends `session.update` with
  `output_modalities: ["text"]`.

The API key never leaves the server. The browser just POSTs its SDP offer to our `/api/dm/voice`.

## Session config (`sessionConfig`)

```ts
{
  type: "realtime",
  instructions,                        // buildInstructions(campaign, state)
  output_modalities: ["audio"],        // or ["text"]
  tools: realtimeToolDefs(),           // from @dm/shared (zod → JSON Schema)
  tool_choice: "auto",
  audio: {
    input: {
      transcription: { model: TRANSCRIBE_MODEL },
      noise_reduction: { type: "far_field" },      // one mic in the middle of a table
      turn_detection: { type: "semantic_vad", eagerness: "auto",
                        create_response: false,    // we respond after speaker ID
                        interrupt_response: true } // players can cut the DM off
    },
    output: { voice: REALTIME_VOICE }
  }
}
```

## Event handling (`DmSession.onEvent`)

| Event | Action |
|---|---|
| `input_audio_buffer.speech_started` | `speechStart = now - 450ms`, status `listening` |
| `input_audio_buffer.speech_stopped` | `speechEnd = now` |
| `input_audio_buffer.committed` | `host.identifySpeaker(start,end)` → system note → `requestResponse()` |
| `conversation.item.input_audio_transcription.completed` | `onPlayerText(transcript, label)` (logged) |
| `response.created` | `responseActive = true`, status `thinking` |
| `output_audio_buffer.started` / `stopped` / `cleared` | status `speaking` / `listening` |
| `response.output_audio_transcript.done`, `response.output_text.done` | `onDmText` (logged) |
| `response.done` | Run every `function_call` output with `Promise.all`, send each `function_call_output`, then `response.create` |
| `error` | `conversation_already_has_active_response` → queue; otherwise report to the host |

`output_audio_buffer.*` events only reach the sideband in voice mode; text mode never reports
`speaking`.

Tool errors never throw into the session. They come back to the model as `{ "error": "..." }` so it
can correct itself (for example, by calling `get_party_status` for ids).

`requestResponse()` never sends two `response.create` calls at once. If one is active, it sets
`wantResponse` and fires again on the next `response.done`.

## Reconnect and idle watch

`DmSession` takes an optional `DmSessionOptions` as its fourth constructor argument:
`createSocket(url, headers)` (default: a `ws` WebSocket; tests inject a fake `SocketLike`),
`retryDelaysMs` (default `[1000, 2000, 4000, 8000, 16000]`), `idleWarnMs` (default 5 min) and `warn`.

- **First connect.** `connect()` resolves on `open`. If the socket errors or closes before it ever
  opens, the promise rejects, the status goes `offline`, and there is no retry. `startVoice` and
  `startText` report the failure.
- **Unexpected drop.** A `close` that `close()` did not cause schedules a reconnect. Each attempt
  waits the next delay from `retryDelaysMs`. While it waits the status is `connecting`, and the
  first drop sends an `error` event ("Realtime connection dropped; reconnecting…"). A successful
  `open` resets the attempt counter.
  - Voice reconnects to the **same `call_id`**. The conversation lives on the call, so nothing is
    re-sent.
  - Text opens a new `?model=` session. It re-sends `session.update` and adds a system note with
    `host.recentContext()` (the last 15 DM, player and roll log lines, at most 3000 characters),
    because the old conversation is gone.
  - In both modes, `responseActive` and `wantResponse` are reset: the in-flight response is lost.
- **Giving up.** After the last delay the session closes for good. It reports "Realtime connection
  lost; gave up after N reconnect attempts. Restart the DM." and the status goes `offline`.
- **`close()`** (stop, or a new session replacing this one) cancels a pending retry. It does not
  emit `offline` itself; `stopDm` already does. The old handler did emit it, which could overwrite
  the next session's status (see `.memories/bugs/stale-dm-offline-status.md`).
- `isReconnecting` is true between a drop and the next `open`. `sendText` and `whisper` then
  answer "The DM is reconnecting; try again in a moment."
- **Idle watch.** While a socket is open, a timer (every `idleWarnMs / 4`) logs one warning when
  nothing has arrived for `idleWarnMs`. It only logs; it resets on the next message.

### Browser side (`VoiceLink`)

`VoiceLink` watches `RTCPeerConnection.connectionState`:
- `failed` rebuilds the call at once. `disconnected` gets `DISCONNECT_GRACE_MS` (5 s) to recover on
  its own first.
- A rebuild tears down the peer and POSTs a new offer to `/api/dm/voice?resume=1`, trying
  immediately and then after 1, 2 and 4 s (`RECONNECT_DELAYS_MS`). If every attempt fails, the
  state is `failed` with `error`.
- `GameService.startVoice(offer, resume=true)` replaces the old DM session and calls
  `DmSession.resume()` instead of `begin()`. That sends a recap note and asks for one short "I'm
  back" line rather than the opening greeting (a new call has no conversation).
- States are `idle | connecting | connected | reconnecting | failed`, available through
  `subscribe()`. PlayTab shows a "voice link" pill and a **↻ Reconnect** button that calls
  `reconnect()` by hand. The DM status pill reads "reconnecting…" when the status returns to
  `connecting` after the DM was already live.
- Peer creation, the offer POST and audio playback are injectable (`VoiceLinkDeps`), so
  `voice.test.ts` drives it with a fake peer.

## NPC voices

The Realtime output voice cannot change after the session has produced audio. NPCs are therefore
handled in two ways:
1. **Voice direction (always on).** Each outline NPC has a `voice` field (accent, pitch, pace,
   verbal tics). The brain fills it in `generateOutline`. `buildInstructions` prints it as
   `Voice: …` after each NPC, and the persona tells the DM to perform it every time.
2. **`speak_as_npc` (optional, `NPC_TTS=1`).** The tool synthesizes one short line with
   `client.audio.speech.create({ model: NPC_TTS_MODEL, voice, input, instructions, response_format:
   "mp3" })` in `npc-voice.ts`.
   - `voice` is picked from the built-in speech voices by a hash of the NPC name, never the DM's
     `REALTIME_VOICE`. `instructions` is the NPC's voice direction plus the call's `style`.
   - The file is `<DATA_DIR>/<campaign>/assets/npc_<hash>.mp3`, cached by model, voice, direction
     and line. It is served at `/media/<campaign>/npc_<hash>.mp3`.
   - The server broadcasts `{ type: "npc_speech", npcName, line, url }` and logs the line under
     the NPC's name. `/table` plays the mp3 (`useServer`).
   - The tool is only sent to the model when enabled (`dmToolDefs(npcTts)`), and the persona gets a
     short "use sparingly, then stay silent" note (`buildInstructions(..., { npcTts })`).
   - With the feature off it returns `{ ok: false, error }` so the DM just speaks the line itself.

## Instructions (`instructions.ts`)

`buildInstructions` concatenates:
- The **persona** (voice style, speaker-note handling, mechanics-through-tools rules).
- The adventure title and hook, the acts, and the location ids (for `change_scene`).
- The **current location** with its planned encounters, plus the NPCs, each with its `Voice:`
  direction when set.
- With `npcTts`, a short note on when to use `speak_as_npc`.
- The **last session recap**.
- The **party block**: ids, AC, HP, modifiers, skills, attacks, and each player's dice mode.

`refreshInstructions()` sends `session.update` after a scene change or a roster or character
change. HP is not pushed on every hit; the model calls `get_party_status` when it needs it.

`openingPrompt` asks for a recap, or for a hook and scene-setting, then "what do you do?".

## Other ways to talk to the DM

- `sendPlayerText(text, note)` handles typed player input, in text mode or while voice is live.
- `resume()` continues after the browser rebuilt the WebRTC call (see above).
- `prompt(note)` sends a host whisper (`/api/dm/whisper`) or a physical-roll notification as a
  system note, followed by a response.

## Known limits / TODO

- Timestamps for the speech window come from server wall-clock time around VAD events, not from
  `audio_start_ms`, so alignment is approximate. It is good enough for turns of 0.6 s or longer.
- A voice sideband reconnect only works while the WebRTC call itself is alive. If the call is gone,
  the retries fail and the browser's `VoiceLink` (or the host's Reconnect button) builds a new call.
- `speak_as_npc` audio plays on the TV while the Realtime DM's audio plays on the host laptop. The
  persona asks the DM to wait, but nothing enforces it.
