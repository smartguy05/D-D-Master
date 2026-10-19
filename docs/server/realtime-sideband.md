---
title: Realtime voice DM and sideband
area: server
topic: realtime
related_code:
  - apps/server/src/realtime/**
  - apps/web/src/lib/voice.ts
created: 2026-09-24
last_updated: 2026-10-19
last_audited: 2026-10-19
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-19: DmHost.onUserSpeech on speech_started/stopped (live who's talking)"
  - "2026-09-24: Sideband auto-reconnect with backoff, idle warning, VoiceLink reconnect + resume, NPC voice direction and speak_as_npc"
  - "2026-09-24: Initial version (GA Realtime API, openai SDK v7)"
  - "2026-09-24: Builder instructions block, notifyDm"
  - "2026-09-24: Persona covers fog of war and play_effect"
  - "2026-10-18: Persona Spectacle line: target_id/attack_name on attack rolls, source_id on apply_damage"
  - "2026-10-18: Current location line states the party enters from the left"
  - "2026-10-18: Current location lists map features with grid cells"
  - "2026-10-18: interrupt_response false: the DM always finishes narrating"
  - "2026-10-18: Persona: spawn_monster near/formation/hidden for staging and ambushes"
  - "2026-10-18: stopTalking (host cut-off)"
  - "2026-10-18: dmToolDefs drops host-only tools; instructions use effective features; set_monster_hidden"
  - "2026-10-18: Re-attach to the live call after a server restart (persisted call id, retryFirstConnect), lost-call banner"
  - "2026-10-18: Noise-turn gate (TURN_GATE, isNoiseTranscript, conversation.item.delete) and [turn-timing] logs"
  - "2026-10-18: NPC clip queue: hold npc_speech until the DM is silent, holdResponses until the clip ended"
  - "2026-10-18: Review fixes: no short-audio rule, numbers/mhm/you kept, live-test watch list, reconnect keeps a pending response, give-up clears the call record, clip reservation and duration clamp, muted tables do not report"
  - "2026-10-18: Review round 2: outbox for conversation items while disconnected, frames after close ignored, speaking reset on reconnect, slow-synthesis NPC error, clip length trusted up to 8 s"
  - "2026-10-18: Review round 3: instructions refreshed while down are re-sent on reconnect; late-opening sockets are closed"
  - "2026-10-18: Rules MECHANICS bullet and compact rules tail in the party block"
  - "2026-10-18: Stall nudge: a speech-only reply on a DM-played combat turn prompts the DM once (host.stalledTurn); persona lines for whole monster turns and add_npc"
  - "2026-10-19: Move cap: MAX_MOVES_PER_REPLY move_token calls per token per reply (refuseMove); persona line on using furniture from beside it"
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
                        interrupt_response: false } // the DM always finishes; speech is answered after
// Host "Stop talking" → DmSession.stopTalking(): response.cancel (if a response is active),
// output_audio_buffer.clear (voice/WebRTC only), drop the queued reply, and a system note
// telling the model not to repeat what was cut off.
    },
    output: { voice: REALTIME_VOICE }
  }
}
```

## Event handling (`DmSession.onEvent`)

| Event | Action |
|---|---|
| `input_audio_buffer.speech_started` | `speechStart = now - 450ms`, keep `audio_start_ms`, status `listening`, `host.onUserSpeech(true)` (live who's talking) |
| `input_audio_buffer.speech_stopped` | `speechEnd = now`, keep `audio_end_ms`, `host.onUserSpeech(false)` |
| `input_audio_buffer.committed` | `host.identifySpeaker(start,end)` → speaker note (with our own item id) → gate (below), or `requestResponse()` when the gate is off |
| `conversation.item.input_audio_transcription.completed` | Gate decision; `onPlayerText(transcript, label)` (logged) unless skipped |
| `conversation.item.input_audio_transcription.failed` | Gate: answer the turn anyway |
| `response.created` | `responseActive = true`, status `thinking` |
| `output_audio_buffer.started` / `stopped` / `cleared` | status `speaking` / `listening` |
| `response.output_audio_transcript.done`, `response.output_text.done` | `onDmText` (logged) |
| `response.done` | Run every `function_call` output with `Promise.all`, send each `function_call_output`, then `response.create`. A speech-only reply: send a queued request if any, else the stall check (below) |
| `error` | `conversation_already_has_active_response` → queue; otherwise report to the host |

`output_audio_buffer.*` events only reach the sideband in voice mode; text mode never reports
`speaking`.

Tool errors never throw into the session. They come back to the model as `{ "error": "..." }` so it
can correct itself (for example, by calling `get_party_status` for ids).

`requestResponse()` never sends two `response.create` calls at once. If one is active, it sets
`wantResponse` and fires again on the next `response.done`.

**Stalled combat turns.** The loop only continues by itself after tool calls. A reply that is only
speech ("Next up: Awakened Shrub 2. Let's see where it moves.") ends it, and players wait for the
DM, so the game would sit silent. After a completed speech-only reply with nothing queued,
`nudgeStalledTurn` asks `host.stalledTurn()` (GameService → `engine/turns.ts`). When a monster or
NPC still holds the turn, it adds that prompt as a system note and requests a response. Limits:
no nudge when the reply ends with a question (the DM is waiting for a reaction or a choice), at
most `MAX_STALL_NUDGES_IN_A_ROW` (1) per run of speech-only replies (a tool call resets it), and
`MAX_STALL_NUDGES_PER_TURN` (3) per turn key. Each nudge logs `[stall] nudging the DM: <key>`.

**Move cap.** A reply is a chain of tool rounds until the DM speaks without calling a tool. Within
one, `refuseMove` lets each `entity_id` take `MAX_MOVES_PER_REPLY` (2) `move_token` calls. Later
calls aren't run and return `{ error: "…already moved twice…" }`, with a `[moves]` log line. The
count resets when the reply ends or a batch contains `next_turn`. This stops a hunt for a cell that
keeps getting redirected: one play-test had 80 moves around a lever. The persona also says that
furniture is used from beside it.

## Noise-turn gate and turn timing

Semantic VAD can commit a cough or an "uh" as a turn, and the DM would answer it ("bless you").
With `TURN_GATE` on (default) each committed turn is tracked by its `item_id` and its response
waits for the transcript:
- `transcription.completed` → `isNoiseTranscript(text)` (`realtime/noise.ts`, pure, tested).
  Noise = empty, punctuation only, transcriber annotations (`[noise]`, `*cough*`, `(sneezes)`),
  fillers (`uh`, `um.`, `Hmm...`, `er`, `ah`, `oh`, stretched forms), or `bless you` /
  `gesundheit` as the whole turn. Any real word ("yes", "no", "attack!", "Uh, I attack"),
  `mhm`/`mm-hmm` (a "yes"), a lone "You." and anything with a digit or a number word ("six",
  "nat 20", "seventeen") keeps the turn. There is no speech-length rule: `audio_start_ms`
  includes the VAD prefix padding, so the window length says little about a quick "six".
  - **Noise**: `conversation.item.delete` for the audio item and for its speaker note, no log
    line, no response, status back to `listening` (unless the DM is talking or another turn waits).
  - **Real**: the speaker's `accept()` runs, the line is logged, `requestResponse()`.
- `transcription.failed` → answer (we can't tell). After `TURN_GATE_TIMEOUT_MS` (1200) with no
  transcript → answer; a late transcript is still logged, without a second response.
- Speaker-ID side effects live in `SpeakerTurn.accept()` (announce the speaker, consume the host's
  "who's speaking" tap, keep or clear the low-confidence sample for `confirm_speaker`), so a
  skipped turn leaves no trace. With the gate off, `accept()` runs on commit.
- Typed input (`sendPlayerText`) and text mode are never gated. `close()` cancels gate timers.

Every turn logs greppable lines (`grep turn-timing`), also with the gate off:
`[turn-timing] item=<id> speech=<ms> transcript=<ms after commit> gate=respond|skip|failed|timeout|off`
and, for the turn that was answered, `[turn-timing] item=<id> speech=<ms> audio_start=<ms after
commit>` when the DM's audio starts. Use them to pick `TURN_GATE_TIMEOUT_MS` and to see the
latency the gate adds (transcript time minus the old commit-time start).

### What to watch in live tests

- **Hallucinated transcripts.** Transcription models sometimes "hear" words in pure noise, most
  often "Thank you.", "you", "Bye." or subtitle-style phrases ("Thanks for watching!"). Those
  contain real words, so the gate answers them. Grep the `[turn-timing] … gate=respond` lines
  next to the player log; if one shows up often, add it as a whole-turn phrase in `noise.ts`
  (with a test) rather than loosening the word rules.
- **False skips.** Any `gate=skip` on a turn a player meant (a mumbled "mm-hmm" now counts as
  real; check short answers, names and numbers).
- **Latency.** `transcript=` ms is roughly what the gate adds before the DM starts; pick
  `TURN_GATE_TIMEOUT_MS` above its usual value. `gate=timeout` lines mean the timeout was hit.
- **Drops during a turn.** A gate decision made while the sideband is reconnecting is kept
  (`wantResponse`) and sent after the reconnect.

## Reconnect and idle watch

`DmSession` takes an optional `DmSessionOptions` as its fourth constructor argument:
`createSocket(url, headers)` (default: a `ws` WebSocket; tests inject a fake `SocketLike`),
`retryDelaysMs` (default `[1000, 2000, 4000, 8000, 16000]`), `idleWarnMs` (default 5 min) and `warn`.

- **First connect.** `connect()` resolves on `open`. If the socket errors or closes before it ever
  opens, the promise rejects, the status goes `offline`, and there is no retry. `startVoice` and
  `startText` report the failure. With `retryFirstConnect: true` (used only for the re-attach
  below) the first connect is retried with `retryDelaysMs` too; failed attempts are `warn`ings,
  and the promise rejects with the last error once every attempt failed. `close()` during the
  wait cancels it and rejects the pending `connect()` without emitting `offline`.
- **Unexpected drop.** A `close` that `close()` did not cause schedules a reconnect. Each attempt
  waits the next delay from `retryDelaysMs`. While it waits the status is `connecting`, and the
  first drop sends an `error` event ("Realtime connection dropped; reconnecting…"). A successful
  `open` resets the attempt counter.
  - Voice reconnects to the **same `call_id`**. The conversation lives on the call, so nothing is
    re-sent.
  - Text opens a new `?model=` session. It re-sends `session.update` and adds a system note with
    `host.recentContext()` (the last 15 DM, player and roll log lines, at most 3000 characters),
    because the old conversation is gone.
  - In both modes `responseActive` and `speaking` are reset (the in-flight response is lost, and a
    lost `output_audio_buffer.stopped` must not leave the DM "speaking"). A response asked for
    while the socket was closed (`requestResponse` only sets `wantResponse` then: a gate timeout,
    a whisper, an NPC hold release) is kept and sent right after the next `open`.
  - **Outbox.** While the socket is down, `conversation.item.create` and `conversation.item.delete`
    events (a tool's `function_call_output`, system notes, noise-turn deletes) are buffered, at most
    `OUTBOX_MAX` (100, oldest dropped with a warning), and flushed in order on `open`, **before** the
    pending `response.create`. So a tool that finished during a drop is answered once and is not
    re-run by a blind follow-up. `response.create` itself is never buffered. Text mode drops
    buffered `function_call_output`s (the new session has no such call) but keeps notes.
  - Frames that arrive after `close()` (real `ws` still emits in-flight messages) are ignored, so
    no tools run for a closed session.
  - `refreshInstructions()` while the socket is down sets a dirty flag; the next voice `open`
    sends `session.update` with the then-current instructions first (before the outbox). A clean
    voice reconnect still sends nothing. A socket that opens after `close()` is closed at once.
- **Giving up.** After the last delay the session closes for good. It reports "Realtime connection
  lost; gave up after N reconnect attempts. Restart the DM." and the status goes `offline`.
  `GameService` then drops that session and clears the saved call record (only for the current
  session; statuses from a replaced session are ignored), so a later restart doesn't re-attach
  to a dead call. `DmSession.closedByCaller` tells a host Stop/replace apart from giving up.
- **`close()`** (stop, or a new session replacing this one) cancels a pending retry. It does not
  emit `offline` itself; `stopDm` already does. The old handler did emit it, which could overwrite
  the next session's status (see `.memories/bugs/stale-dm-offline-status.md`).
- `isReconnecting` is true between a drop and the next `open`. `sendText` and `whisper` then
  answer "The DM is reconnecting; try again in a moment."
- **Idle watch.** While a socket is open, a timer (every `idleWarnMs / 4`) logs one warning when
  nothing has arrived for `idleWarnMs`. It only logs; it resets on the next message.

### Re-attach after a server restart

If the server restarts, the browser's WebRTC call to OpenAI keeps running, but nothing executes
its tools. So the server remembers the live call:
- `startVoice` saves `{callId, campaignId, startedAt}` in the SQLite `kv` table
  (`Store.setActiveCall`). `stopDm` (also called by `loadCampaign`, `endSession`, `startText` and
  a new `startVoice`) clears it, and so does a failed first sideband connect.
- `GameService.init()` reads the record **before** loading the last campaign. If it belongs to that
  campaign and is younger than `VOICE_CALL_MAX_AGE_MS` (60 min, the Realtime session cap), it
  calls `reattachVoice`: a new `DmSession("voice", callId, { retryFirstConnect: true })`, then
  `refreshInstructions()` and the `RESTART_NOTE` system note, and a system log line. There is no
  `begin()` greeting and no `response.create`: the DM waits for the next player turn.
- If every attempt fails (the call ended while the server was down), the record is cleared, an
  `error` event says "Could not re-attach…", and the DM stays `offline`. The host's lost-call
  banner (below) then offers Reconnect. A host Stop or new call during the retries supersedes the
  re-attach silently.
- Tested in `game/service.voice.test.ts` with a fake socket and an in-memory store.

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
- **Lost-call banner.** `host/lostCall.ts` (pure, tested): when `/ws` is connected, the link is
  `connected` and the server DM has been `offline` for `LOST_CALL_GRACE_MS` (3 s), PlayTab shows a
  red notice with **↻ Reconnect voice DM** (`VoiceLink.reconnect()`, i.e. a new call with
  `?resume=1`). The grace period hides it during a quick re-attach (status `connecting`).
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
   - The line is logged under the NPC's name at once, but the audio is **queued**
     (`npc-queue.ts` `NpcClipQueue`, see below). The tool returns "plays right after you stop
     talking … do not keep talking".
   - The clip length comes from the mp3 itself (`mp3DurationMs`: skips an ID3v2 tag, then the
     Xing/Info frame count, or the CBR bitrate when the count is missing or absurd).
     `clipDurationMs` trusts it up to 8 s (a short line with long pauses), and above that falls
     back to ~15 characters per second when it is over 60 s or more than 3× that estimate.
   - The tool is only sent to the model when enabled (`dmToolDefs(npcTts)`; `dmToolDefs` also always
     drops the host-only board tools `edit_fog` and `edit_map_feature`), and the persona gets a
     short "use sparingly, then stay silent" note (`buildInstructions(..., { npcTts })`).
   - With the feature off it returns `{ ok: false, error }` so the DM just speaks the line itself.

### NPC clip queue (no overlap with the DM)

- `speakAsNpc` takes its place with `NpcClipQueue.reserve()` **before** awaiting synthesis, so
  several `speak_as_npc` calls in one response (run in parallel) play in call order. A slot is
  freed by `cancel()` when synthesis throws, and dropped after `RESERVE_MAX_MS` (30 s) if never
  filled. `slot.play()` returns false for a dropped slot; `speakAsNpc` then returns `{ok:false,
  error:"NPC voice was too slow; speak the line yourself"}` and doesn't log the line.
  `enqueue(clip)` = reserve + play.
- The queue broadcasts `{ type: "npc_speech", npcName, line, url }` only while
  the DM is silent: `GameService`'s `onStatus` calls `setDmSpeaking(status === "speaking")`
  (except for `connecting`, which keeps the last state during a sideband reconnect), i.e.
  it waits for `output_audio_buffer.stopped`/`cleared`. If the DM still reports speaking after
  `DM_SPEAKING_MAX_WAIT_MS` (30 s) the clip plays anyway.
- Clips play one at a time, in order. Each resolves when `/table` POSTs `/api/npc/clip-ended
  {url}` for the playing clip, or after its length + `CLIP_END_GRACE_MS` (1.5 s), so no table,
  a muted table or a lost report never blocks the DM. `stopDm` clears the queue.
- The service passes that promise to `DmSession.holdResponses(done)`: every `response.create`
  (the tool follow-up and any player turn meanwhile) waits until all holds are released (each
  also releases after `DEFAULT_HOLD_MAX_MS`, 60 s), then one merged response is sent.
- `/table` (`apps/web/src/lib/npcAudio.ts` `NpcClipPlayer`) plays clips sequentially and reports
  `ended`, `error` and a rejected `play()` as ended. A muted table (or one muted mid-clip) skips
  clips and reports **nothing**, so the first report always comes from a table that played the
  clip; with every table muted, the server's clip-length timeout releases the DM.

## Instructions (`instructions.ts`)

`buildInstructions` concatenates:
- The **persona** (voice style, speaker-note handling, mechanics-through-tools rules, when to use
  fog of war (`set_fog`, `reveal_area`, `set_monster_hidden` for ambushes), staging spawns
  (`spawn_monster` `near` a named feature, `formation`, `hidden: true` for an ambush), a Spectacle
  line (attacks and spells animate by themselves: pass `target_id`/`attack_name` on attack rolls and
  `source_id` on `apply_damage`; `play_effect` only for extra moments), whole monster/ally turns
  in one reply (never end a reply announcing a monster's turn), `add_npc` for NPCs who join,
  follow or fight beside the party, and
  one compact bullet for the rules engine: `cast_spell`, `short_rest`/`long_rest`, `level_up`,
  `use_resource`, with death saves and concentration checks automatic).
- The adventure title and hook, the acts, and the location ids (for `change_scene`).
- The **current location** (grid size, axes, and that the party enters from the left edge with the
  far end on the right), its **map features** with grid cells (`describeFeatures(effectiveFeatures(state, loc))`, so the
  host's Board-tab fixes win; tags `focal`, `lit`, `blocks`, e.g.
  `- altar (focal, lit): x 12-16, y 1-3`), and its planned encounters, plus the NPCs, each with its `Voice:`
  direction when set.
- With `npcTts`, a short note on when to use `speak_as_npc`.
- The **last session recap**.
- The **party block**: ids, class (and subclass), AC, HP, modifiers, skills, attacks, each player's
  dice mode, and a compact rules tail (`rulesSummary`: `slots 1:2/4 2:0/3; pact L3 1/2; HD 4/5 d6;
  conc Bless; DOWN saves S1 F2; Rage 2/3`, left/max). Resource notes are left out to keep it short.
- While a build is running (`state.builder`), a **CHARACTER BUILDER ACTIVE** block with the draft
  and the missing fields. The persona's *NEW CHARACTERS* section explains the interview flow
  (`start_character_builder` → `draft_character_update` → `finalize_character`) and how to handle
  phone-roll notes.

`refreshInstructions()` sends `session.update` after a scene change or a roster or character
change. HP is not pushed on every hit; the model calls `get_party_status` when it needs it.

`openingPrompt` asks for a recap, or for a hook and scene-setting, then "what do you do?".

## Other ways to talk to the DM

- `sendPlayerText(text, note)` handles typed player input, in text mode or while voice is live.
- `resume()` continues after the browser rebuilt the WebRTC call (see above).
- `prompt(note)` sends a host whisper (`/api/dm/whisper`) or a physical-roll notification as a
  system note, followed by a response. `GameService.notifyDm(text)` wraps it; it returns false
  when no DM is running. It is used for phone rolls, physical totals and builder start/cancel.

## Known limits / TODO

- The noise gate adds the transcription latency (roughly the `transcript=` ms) to every voice
  reply, and responses triggered meanwhile (tool follow-ups) already see the pending audio item.
  Measure with real speech before tuning.
- Timestamps for the speech window come from server wall-clock time around VAD events, not from
  `audio_start_ms`, so alignment is approximate. It is good enough for turns of 0.6 s or longer.
- A voice sideband reconnect only works while the WebRTC call itself is alive. If the call is gone,
  the retries fail and the browser's `VoiceLink` (or the host's Reconnect button) builds a new call.
- After a restart re-attach, tool calls that were in flight when the server died get no output;
  the model is told so in `RESTART_NOTE`. Not live-tested yet.
- `speak_as_npc` audio plays on the TV while the Realtime DM's audio plays on the host laptop. The
  queue keeps them apart in time, but the model can still start audio in the same response
  before the tool call; that audio finishes first, then the clip plays. Not live-tested yet.
