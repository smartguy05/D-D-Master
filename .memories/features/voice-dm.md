# Feature: Voice DM (OpenAI Realtime + sideband)
Status: done (vertical slice)
Docs: docs/server/realtime-sideband.md, docs/architecture/data-flow.md

## Overview
The DM speaks and listens through OpenAI Realtime (voice-to-voice) over WebRTC from the host
browser. The server creates the call (`realtime.calls.create`, multipart sdp + session) and
attaches a sideband WebSocket (`?call_id=`) that executes every tool against the game state.
Players can't cut the DM off (`interrupt_response: false`, 2026-10-18); speech during narration is
queued and answered after. A text-only mode uses the same loop.

## Notes
- `create_response: false` is deliberate: we insert a `[speaker: …]` system note after speaker ID
  and then call `response.create` ourselves.
- `DmSession.requestResponse` queues while a response is active, to avoid
  `conversation_already_has_active_response`.
- Tool errors go back to the model as `{error}`; they never throw.
- Reconnect: `DmSession` retries unexpected sideband drops with backoff (1/2/4/8/16 s). Voice
  reuses the call_id (the conversation survives); text re-sends `session.update` plus a recent-log
  note. The first connect is never retried, except with `retryFirstConnect` (restart re-attach).
  `close()` must not emit `offline` (see
  bugs/stale-dm-offline-status.md). The socket factory is injectable for tests.
- Browser: `VoiceLink` rebuilds the WebRTC call on `failed`, or after 5 s of `disconnected`, via
  `/api/dm/voice?resume=1`. The server then calls `DmSession.resume()` (no re-greeting).
- NPC clips never overlap the DM: queue + hold (see docs/server/realtime-sideband.md "NPC clip
  queue"). Every wait has a timeout (30 s DM-speaking cap, clip + 1.5 s, 60 s hold cap).
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
- [ ] Live-test `speak_as_npc` with NPC_TTS=on and real speakers: the clip should start only
      after the DM's audio stops, and the DM should continue only after the clip ends
- [ ] Live-test the restart re-attach: kill and restart the server mid-call; check that the
      sideband re-attaches to the saved call_id, tools run again, and that the lost-call banner +
      Reconnect work when the call has ended
- [ ] Live-test the noise gate: read `[turn-timing]` lines, pick the TURN_GATE_TIMEOUT_MS default,
      and check coughs/"uh" get no reply while short real answers ("yes", "no", "six") still do; watch
      for hallucinated "Thank you." on noise (see realtime-sideband.md "What to watch")
- [ ] Use `audio_start_ms` / `audio_end_ms` for more precise speech windows
- [ ] Optional push-to-talk mode for very noisy rooms
- [ ] Background music / ambience cues from the DM (tool: set_ambience)

## Completed
- 2026-10-18: Review round 3: `refreshInstructions()` during a voice sideband drop is remembered
  and sent on the next open; a socket that opens after `close()` is closed; test for the 250 ms
  replaced-call guard in `startVoice`.
- 2026-10-18: Review round 2 fixes: outbox buffers conversation items while the sideband is down
  (no blind response.create; bugs/blind-response-after-drop.md), frames after close() ignored,
  `speaking` reset on reconnect, slow NPC synthesis returns an error to the DM, clip lengths up to
  8 s trusted, NPC queue keeps its speaking state while "connecting". `createVoiceCall` is
  injectable in GameService for tests.
- 2026-10-18: Review round 1 fixes: gate decision survives a sideband reconnect; noise rules no
  longer drop numbers, "mhm"/"mm-hmm" or "You." (short-audio rule removed); NPC clips reserve
  their slot before synthesis (call order); a sideband that gives up clears the call record;
  mp3 length clamped; `TURN_GATE_TIMEOUT_MS=0` and more TURN_GATE off values; muted tables don't
  report clip ends. Bugs: gate-timeout-lost-during-reconnect, npc-clips-out-of-order,
  dead-call-record-kept.
- 2026-10-18: NPC voice overlap (TODO.md 6): `NpcClipQueue` broadcasts `npc_speech` only while the
  DM is silent, one clip at a time; `DmSession.holdResponses` defers the follow-up until /table
  POSTs `/api/npc/clip-ended` or clip length (from the mp3) + 1.5 s. /table `NpcClipPlayer`
  queues, respects mute and reports errors as ended. Tests: npc-queue.test.ts,
  session.test.ts (holdResponses), npc-voice.test.ts (mp3DurationMs), npcAudio.test.ts,
  service.voice.test.ts.
- 2026-10-18: Noise-turn gate (TODO.md 4): `[turn-timing]` instrumentation; with TURN_GATE on the
  reply waits for the transcript (or `.failed`, or TURN_GATE_TIMEOUT_MS); `isNoiseTranscript`
  turns are deleted (`conversation.item.delete` for the audio item and its speaker note) and not
  answered. Speaker-ID side effects moved to `SpeakerTurn.accept()` so skipped turns don't touch
  `lastUnconfirmed`. Tests: noise.test.ts, session.test.ts (turn gate), service.voice.test.ts.
- 2026-10-18: Lost voice call (TODO.md 3): the live call id is persisted (`kv.active_voice_call`);
  `init()` re-attaches the sideband after a restart (`retryFirstConnect`, refresh instructions,
  restart note, no greeting). Host PlayTab shows a lost-call banner with Reconnect when the link is
  connected but the DM has been offline for 3 s. Tests: service.voice.test.ts, session.test.ts,
  lostCall.test.ts.
- 2026-10-18: DM no longer cut off mid-narration by table talk (interrupt_response false; status
  stays `speaking` during playback).
- 2026-10-18: Host **✋ Stop talking** button → `/api/dm/stop-talking` → `DmSession.stopTalking()`
  (response.cancel + output_audio_buffer.clear + drop queued reply + "don't repeat" note). Verified
  in text mode (opening cut, log line written); voice-mode audio cut not yet live-tested.
- 2026-09-24: WebRTC call creation, sideband tool loop, text mode, speaker-note injection,
  queueing, transcripts to log, host whisper and typed input. Unit tests in session.test.ts.
- 2026-09-24: Auto-reconnect: sideband retry with backoff (same call_id / text recap), idle
  warning, VoiceLink WebRTC rebuild with resume, host "voice link" pill and Reconnect button.
  Tests: session.test.ts (fake socket and fake timers), web voice.test.ts (fake peer).
- 2026-09-24: Per-NPC voices: Npc.voice direction (brain fills it, instructions print it) and the
  optional speak_as_npc TTS tool plus the npc_speech event. Tests: instructions.test.ts,
  npc-voice.test.ts.
- 2026-09-24: NPC voice direction is editable in the host outline editor (merge of voice + campaign-mgmt streams).
