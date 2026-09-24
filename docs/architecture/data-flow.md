---
title: Runtime data flow
area: architecture
topic: data-flow
related_code:
  - apps/server/src/realtime/session.ts
  - apps/server/src/game/service.ts
  - apps/web/src/lib/voice.ts
  - apps/web/src/lib/useServer.ts
  - packages/shared/src/events.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version"
---

# Runtime data flow

## Starting the voice DM

1. On `/host`, **Start voice DM** calls `getTableMic()`, which uses one `getUserMedia` stream with
   echo cancellation.
   - The same stream already feeds `MicStreamer` (AudioWorklet → 16 kHz PCM16 → `/ws/audio`).
2. `VoiceLink.start()` creates an `RTCPeerConnection`, adds the mic track, opens the `oai-events`
   data channel, and POSTs the SDP offer to `/api/dm/voice`.
3. `GameService.startVoice` → `createVoiceCall` calls `openai.realtime.calls.create({ sdp, session })`.
   - The session carries the instructions, the tools, semantic VAD with `create_response: false`,
     transcription and the voice.
   - The response body is the SDP answer. The `Location` header ends with the **call id**.
4. The server returns the answer, so the browser completes the WebRTC connection and plays the DM's
   audio.
5. After 250 ms, the server opens `wss://api.openai.com/v1/realtime?call_id=…` (the sideband) and
   calls `begin()`. That sends a system note with the opening prompt (a recap or the hook), followed
   by `response.create`.

## One spoken player turn

```
player speaks ─► Realtime VAD: input_audio_buffer.speech_started   (server notes t0 = now-450ms)
               ─► input_audio_buffer.speech_stopped                 (t1 = now)
               ─► input_audio_buffer.committed {item_id}
server: GameService.identifySpeaker(t0, t1)
          host tap within 20 s? → use it
          one player with a character? → them
          else AudioRing.slice(t0,t1) → trimSilence → embedding → matchSpeaker
server ─► conversation.item.create  (system: "[speaker: Sam as Thorin, confidence 0.83]")
server ─► response.create
Realtime ─► response.created, output_audio_buffer.started (DM speaking; table orb glows)
Realtime ─► conversation.item.input_audio_transcription.completed → log "Sam as Thorin: I attack"
Realtime ─► response.done {output:[function_call…]}
server: runTool() for each call in parallel → engine → commit → broadcast state + roll events
server ─► conversation.item.create (function_call_output) × N, then response.create
Realtime ─► speaks the outcome ("The goblin reels — 9 damage!")
```

**Interruptions.** `interrupt_response: true` lets a player cut the DM off. Realtime cancels the
current response and truncates its audio, and WebRTC stops playback. `DmSession` queues
`response.create` calls while a response is active (`wantResponse`), so a turn is never dropped.

## Text mode

`/api/dm/text` opens a server-only WebSocket (`?model=`) with `output_modalities: ["text"]`. It
uses the same tools and the same `DmSession` event loop. Typed messages go through
`sendPlayerText(text, speakerNote)`. Use it to test without a mic, or when voice is not wanted.

## Host actions and broadcasting

- Every mutation goes through `GameService.commit(state)`. That saves `game_states`, appends to
  `events`, and broadcasts `{type:"state"}` to every `/ws` client.
- Dice results are also broadcast as `{type:"roll"}`, so the table can animate them in order.
- Slow work (outline writing, maps, sprites, recaps) is wrapped in `job()`. That emits `{type:"job"}`
  as running, then done or error, which drives the spinners on both screens.
- A new socket gets a snapshot right away (`campaign`, `dm_status`, `state`).

Event types live in `packages/shared/src/events.ts`.
