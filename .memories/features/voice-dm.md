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
- The call id comes from the `Location` header of `POST /v1/realtime/calls`.
- The persona is in `apps/server/src/realtime/instructions.ts`. Keep it short: it is resent on
  every `session.update`.
- The OpenAI docs sites (platform/developers.openai.com) were blocked from the build sandbox. The
  API shapes were verified against the openai SDK v7.23 type definitions instead
  (`resources/realtime/*.d.ts`).

## TODOs
- [ ] Live test with a real key and people at a table (not possible in the build sandbox)
- [ ] Auto-reconnect the sideband / WebRTC when it drops
- [ ] Per-NPC voices (switch the `voice` per response, or a second session)
- [ ] Use `audio_start_ms` / `audio_end_ms` for more precise speech windows
- [ ] Optional push-to-talk mode for very noisy rooms
- [ ] Background music / ambience cues from the DM (tool: set_ambience)

## Completed
- 2026-09-24: WebRTC call creation, sideband tool loop, text mode, speaker-note injection,
  queueing, transcripts to log, host whisper and typed input. Unit tests in session.test.ts.
