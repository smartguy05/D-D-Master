# Feature: Voice DM (OpenAI Realtime + sideband)
Status: done (vertical slice)
Docs: docs/server/realtime-sideband.md, docs/architecture/data-flow.md

## Overview
The DM speaks and listens through OpenAI Realtime (voice-to-voice) over WebRTC from the host
browser. The server creates the call (`realtime.calls.create`, multipart sdp + session) and
attaches a sideband WebSocket (`?call_id=`) that executes every tool against the game state.
Players can interrupt (`interrupt_response: true`). A text-only mode uses the same loop.

## Notes
- `create_response: false` is deliberate: we insert a `[speaker: …]` system note after speaker ID
  and then call `response.create` ourselves.
- `DmSession.requestResponse` queues while a response is active, to avoid
  `conversation_already_has_active_response`.
- Tool errors go back to the model as `{error}`; they never throw.
- Reconnect: `DmSession` retries unexpected sideband drops with backoff (1/2/4/8/16 s). Voice
  reuses the call_id (the conversation survives); text re-sends `session.update` plus a recent-log
  note. The first connect is never retried. `close()` must not emit `offline` (see
  bugs/stale-dm-offline-status.md). The socket factory is injectable for tests.
- Browser: `VoiceLink` rebuilds the WebRTC call on `failed`, or after 5 s of `disconnected`, via
  `/api/dm/voice?resume=1`. The server then calls `DmSession.resume()` (no re-greeting).
- NPC voices: the Realtime voice is fixed once audio has been produced, so NPCs get (a) a `voice`
  performance direction on outline NPCs, printed in the instructions, and (b) an optional
  `speak_as_npc` tool (NPC_TTS=1) that renders one line with the speech API
  (`gpt-4o-mini-tts` + `instructions`) to an mp3 that /table plays. Voices are hashed per NPC
  name and never equal REALTIME_VOICE.
- The call id comes from the `Location` header of `POST /v1/realtime/calls`.
- The persona is in `apps/server/src/realtime/instructions.ts`. Keep it short: it is resent on
  every `session.update`.
- The OpenAI docs sites (platform/developers.openai.com) were blocked from the build sandbox. The
  API shapes were verified against the openai SDK v7.23 type definitions instead
  (`resources/realtime/*.d.ts`).

## TODOs
- [ ] Live test with a real key and people at a table (not possible in the build sandbox)
- [ ] Live-test reconnect: kill the network mid-session and check the voice sideband reattaches to
      the same call_id (the retry budget is ~31 s) and that `?resume=1` sounds natural
- [ ] Live-test `speak_as_npc`: overlap between the TV clip and the DM's own audio; maybe mute or
      duck the DM, or play NPC clips through the host laptop instead
- [ ] Host UI to edit an NPC's `voice` direction (outline editing is another workstream)
- [ ] Use `audio_start_ms` / `audio_end_ms` for more precise speech windows
- [ ] Optional push-to-talk mode for very noisy rooms
- [ ] Background music / ambience cues from the DM (tool: set_ambience)

## Completed
- 2026-09-24: WebRTC call creation, sideband tool loop, text mode, speaker-note injection,
  queueing, transcripts to log, host whisper and typed input. Unit tests in session.test.ts.
- 2026-09-24: Auto-reconnect: sideband retry with backoff (same call_id / text recap), idle
  warning, VoiceLink WebRTC rebuild with resume, host "voice link" pill and Reconnect button.
  Tests: session.test.ts (fake socket and fake timers), web voice.test.ts (fake peer).
- 2026-09-24: Per-NPC voices: Npc.voice direction (brain fills it, instructions print it) and the
  optional speak_as_npc TTS tool plus the npc_speech event. Tests: instructions.test.ts,
  npc-voice.test.ts.
