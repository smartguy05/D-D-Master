# Feature: Voice DM (OpenAI Realtime + sideband)
Status: done (vertical slice)
Docs: docs/server/realtime-sideband.md, docs/server/voice-ownership.md, docs/architecture/data-flow.md

## Overview
The DM speaks and listens through OpenAI Realtime (voice-to-voice) over WebRTC from the `/table`
browser page (since 2026-10-21; before that `/host`, see bugs/closing-host-kills-dm.md). `/host`
only sends commands (`voice_command` via `/api/dm/voice/start|reconnect`, `/api/dm/stop`). The server creates the call (`realtime.calls.create`, multipart sdp + session) and
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
- NPC clips are kept apart from the DM's audio by queue + hold (see docs/server/realtime-sideband.md
  "NPC clip queue"), but only from its *audio*: a clip waits while the DM is `speaking`, not while a
  response runs without audio yet. That was enough for `speak_as_npc` (it runs inside the DM's
  response) but let AI player clips talk over a DM that had just started answering
  (bugs/ai-player-talks-over-dm.md). Since 2026-10-21 pc clips also wait on `DmSession.busy` and
  drop after 15 s. The DM's own audio can still precede a clip in the same response. Every wait
  has a timeout (30 s DM-speaking cap, clip + 1.5 s, 60 s hold cap, 15 s busy cap for pc clips).
- NPC voices: the Realtime voice is fixed once audio has been produced, so NPCs get (a) a `voice`
  performance direction on outline NPCs, printed in the instructions, and (b) the
  `speak_as_npc` tool (NPC_TTS, on by default since 2026-10-20; `NPC_TTS=0` turns it off; needs
  OPENAI_API_KEY) that renders one line with the speech API (`gpt-4o-mini-tts` + `instructions`)
  to an mp3 that /table plays. Voices are hashed per NPC name and never equal REALTIME_VOICE.
- Since 2026-10-20 the DM voices EVERY quoted NPC line with speak_as_npc (short lines, narration
  between them in the DM's own voice). The direction resolves Monster.voice (add_npc `voice` or
  `defaultNpcVoice`) > outline voice > `defaultNpcVoice(name)`; never empty.
- Table mic mute (2026-10-19) is a **hard** mute by choice: `track.enabled=false` on the call's
  mic stream (on `/table` since 2026-10-21; `/host` mutes its enrollment mic too) (WebRTC + voice ID go silent, no renegotiation). The server flag lives in GameService
  (runtime, resets on restart) so the TV (P), phones and host (button/P) all toggle it. DmSession
  drops turns committed while muted (deletes the audio item). A reply already playing finishes,
  and unmuting adds a note but no response. The alternative "listen but don't reply" pause was rejected.
- Browser handover (2026-10-21, web side): `VoiceLink.prepareHandover()` builds the standby peer
  with the mic sender muted via `replaceTrack(null)` (not `track.enabled`, which would also mute
  the live call: they share the track) and holds its remote stream; `commitHandover()` unmutes,
  plays it, closes the old peer and promotes the standby so the grace/reconnect handlers watch it.
  Any reconnect/stop drops a pending standby. A `swap` with no ready standby falls back to
  `reconnect()` (resume) in `useTableVoice` (was HostPage before 2026-10-21). Status/orb never change.
- MicStreamer (voice-ID `/ws/audio`) reconnects with 1/2/4/5 s backoff since 2026-10-21 (before
  that a server restart killed voice ID until a page reload; bugs/mic-stream-no-reconnect.md).
- Server handover (2026-10-21): Realtime calls end at 60 min. A 5 s watcher in GameService
  prepares a standby call past VOICE_HANDOVER_AFTER_MS (50 min) at a quiet moment
  (`DmSession.isQuiet()`, no NPC clip, no busy AI player, no table speech for 4 s), then swaps
  when the standby's sideband is open and it's quiet again, or at VOICE_HANDOVER_DEADLINE_MS
  (57 min) once the DM isn't speaking. Swap = refreshInstructions + `seedHandover(note + last 40
  lines)` (no response), `this.dm = standby`, renewed `active_voice_call`, `old.close({quiet})`.
  Standby callbacks are owner-guarded (runTool returns an error). Any failure → abort, retry in
  60 s. Design rationale: make-before-break so there's no gap; the swap waits for silence so no
  half-spoken turn is lost. Doc: docs/server/voice-handover.md.
- Call ownership (2026-10-21, user decision): `/table` always carries the call, mic and DM audio;
  `/host` is controls only and can be closed; enrollment stays on `/host` with its own mic stream
  (`/ws/audio?role=host`, used only while enrolling). Owner table = the one whose call is up, else
  the newest (`game/voice-owner.ts`). A reloaded `/table` auto-resumes once (`voicePlan.ts`).
  `stopDm()` sends `stop` to the table; `startVoice` uses `stopDm({keepCall: true})`. Closing
  `/table` still ends the call (resumes if reopened within ~30 s). Doc: docs/server/voice-ownership.md.
- The call id comes from the `Location` header of `POST /v1/realtime/calls`.
- The persona is in `apps/server/src/realtime/instructions.ts`. Keep it short: it is resent on
  every `session.update`.
- The OpenAI docs sites (platform/developers.openai.com) were blocked from the build sandbox. The
  API shapes were verified against the openai SDK v7.23 type definitions instead
  (`resources/realtime/*.d.ts`).

## TODOs
- [ ] Live: does the DM call npc_focus reliably and clear it? Does the extra tool round-trip
  delay the NPC line noticeably? (see general/live-test-checklist.md)
- [ ] Live test with a real key and people at a table (not possible in the build sandbox) (see general/live-test-checklist.md)
- [ ] Live-test reconnect: kill the network mid-session and check the voice sideband reattaches to
      the same call_id (the retry budget is ~31 s) and that `?resume=1` sounds natural (see general/live-test-checklist.md)
- [ ] Live-test `speak_as_npc` (now on by default, every NPC line) with real speakers: the clip
      should start only after the DM's audio stops, the DM should continue only after the clip
      ends, and a back-and-forth with several lines should not feel slow (TTS latency per line).
      Check the DM really voices every quoted line and narrates between them (see general/live-test-checklist.md)
- [ ] Live-test the restart re-attach: kill and restart the server mid-call; check that the
      sideband re-attaches to the saved call_id, tools run again, and that the lost-call banner +
      Reconnect work when the call has ended (see general/live-test-checklist.md)
- [ ] Live-test the noise gate: read `[turn-timing]` lines, pick the TURN_GATE_TIMEOUT_MS default,
      and check coughs/"uh" get no reply while short real answers ("yes", "no", "six") still do; watch
      for hallucinated "Thank you." on noise (see realtime-sideband.md "What to watch") (see general/live-test-checklist.md)
- [ ] Live-test the table mic mute: with the track disabled, semantic_vad should stay quiet (no
      speech_started on silence). Muting mid-sentence should drop the fragment, not answer it. (see general/live-test-checklist.md)
- [ ] Live-test the browser side of the handover: no audible gap or double audio at the swap, and
      voice ID's "Voice ID offline — reconnecting" pill clears after a server restart (see general/live-test-checklist.md)
- [ ] Live-test the handover end to end (`VOICE_HANDOVER_AFTER_MS=120000`): server logs
      `[handover]` prepare then swap, the DM answers the next line without greeting, and
      `active_voice_call.startedAt` is renewed (see general/live-test-checklist.md)
- [ ] Live-test the /table-owned call on real hardware: mic prompt in the table tab, close
      `/host` mid-game (DM keeps going), reload `/table` (resumes without greeting), autoplay
      unlock for the DM's voice (bugs/closing-host-kills-dm.md) (see general/live-test-checklist.md)
- [ ] Use `audio_start_ms` / `audio_end_ms` for more precise speech windows
- [ ] Optional push-to-talk mode for very noisy rooms
- [ ] Background music / ambience cues from the DM (tool: set_ambience)

## Completed
- 2026-10-21: Play-test fixes: REALTIME_VAD_EAGERNESS (default low; bugs/vad-cuts-slow-speakers), board
  watcher + move_party + exit hints (bugs/dm-no-exploration-moves, bugs/scene-advance-narrated-only),
  sprite safety-filter retry (bugs/sprite-moderation-blocked). Session diagnostics are now saved:
  `tool` events carry outcomes, `diag` events hold [tool]/[moves]/[watch]/[turn-timing]/[cutoff],
  board snapshots, job errors and mic sources. Read them with `scripts/session_log.py`.
- 2026-10-21: The call moved from `/host` to `/table` (useTableVoice, voicePlan auto-resume,
  voice_owner/voice_command/voice_link, Hub roles, requestVoice + `/api/dm/voice/start|reconnect`,
  audio source pick; bugs/closing-host-kills-dm). `DmSession.busy` + `DmHost.onResponseStart`
  for AI player clips (bugs/ai-player-talks-over-dm).
- 2026-10-21: Server: planned voice-call handover (watcher, standby via `/api/dm/voice?handover=1`,
  swap/abort, owner guards, `voice_handover` event, VOICE_HANDOVER_* config); DmSession `isQuiet`,
  `seedHandover`, `close({quiet})`, `onTurnAccepted`. Tests in session.test.ts and
  service.voice.test.ts.
- 2026-10-21: Web: VoiceLink planned handover (prepare/commit/abort on `voice_handover`,
  `postOffer` mode `start|resume|handover`), MicStreamer reconnect + host voice-ID offline pill.
  Tests: web voice.test.ts.
- 2026-10-20: Table clip echo gate (`DmHost.isEcho`, `NpcClipQueue.echoAt`; bugs/npc-clip-mic-echo.md) and `DmHost.onReplyDone` for AI players (features/ai-players.md).
- 2026-10-20: NPC_TTS on by default; NPC_TTS_NOTE voices every quoted NPC line (no more "sparingly"); speak_as_npc uses Monster.voice > outline voice > defaultNpcVoice; add_npc `voice`; back-to-back clip ordering test (npc-queue.test.ts).
- 2026-10-20: Empty tool follow-up nudge (`nudgeEmptyFollowUp`); end-of-combat stall prompt; silent "Host did:" notes for host tool calls; persona: no narration without the tool.
- 2026-10-19: Table mic hard mute: `/api/mic`, `/api/players/:id/mic`, `mic` event,
  `DmSession.setMicMuted`, host button + P hotkey, TV P key + banner, phone header toggle.
- 2026-10-19: `npc_focus` tool + persona line; `DmHost.onDmCaption` (transcript deltas) for NPC
  subtitles and `DmHost.onUserSpeech` (speech_started/stopped) for live who's-talking.
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
- 2026-10-18: Stall nudge for DM-played combat turns (speech-only reply on a monster's turn → one
  prompt; see bugs/dm-stalls-on-monster-turn.md). Persona: whole monster turns in one reply; add_npc.
