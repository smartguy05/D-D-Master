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
  - "2026-09-24: Initial version (GA Realtime API, openai SDK v7)"
  - "2026-09-24: Persona covers fog of war and play_effect"
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

Tool errors never throw into the session. They come back to the model as `{ "error": "..." }` so it
can correct itself (for example, by calling `get_party_status` for ids).

`requestResponse()` never sends two `response.create` calls at once. If one is active, it sets
`wantResponse` and fires again on the next `response.done`.

## Instructions (`instructions.ts`)

`buildInstructions` concatenates:
- The **persona** (voice style, speaker-note handling, mechanics-through-tools rules, when to use
  fog of war (`set_fog`, `reveal_area`) and `play_effect`).
- The adventure title and hook, the acts, and the location ids (for `change_scene`).
- The **current location** with its planned encounters, plus the NPCs.
- The **last session recap**.
- The **party block**: ids, AC, HP, modifiers, skills, attacks, and each player's dice mode.

`refreshInstructions()` sends `session.update` after a scene change or a roster or character
change. HP is not pushed on every hit; the model calls `get_party_status` when it needs it.

`openingPrompt` asks for a recap, or for a hook and scene-setting, then "what do you do?".

## Other ways to talk to the DM

- `sendPlayerText(text, note)` handles typed player input, in text mode or while voice is live.
- `prompt(note)` sends a host whisper (`/api/dm/whisper`) or a physical-roll notification as a
  system note, followed by a response.

## Known limits / TODO

- Timestamps for the speech window come from server wall-clock time around VAD events, not from
  `audio_start_ms`, so alignment is approximate. It is good enough for turns of 0.6 s or longer.
- There's no reconnect on sideband drop yet. The host sees an error and can restart the DM.
