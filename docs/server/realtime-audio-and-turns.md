---
title: Realtime audio and turns (noise gate, NPC voices, echo gate, push-to-talk, mic mute)
area: server
topic: realtime
related_code:
  - apps/server/src/game/floor.ts
  - apps/server/src/game/floor.test.ts
  - apps/server/src/game/service.floor.test.ts
  - apps/web/src/lib/floor.ts
  - apps/web/src/lib/floor.test.ts
  - apps/web/src/player/TalkButton.tsx
  - apps/server/src/realtime/noise.ts
  - apps/server/src/realtime/npc-queue.ts
  - apps/server/src/realtime/npc-voice.ts
  - apps/server/src/realtime/npc-focus.ts
  - apps/server/src/realtime/session.ts
  - apps/web/src/lib/mic.ts
created: 2026-10-21
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Phase 5: a remote holder's voice reaches the DM through the TV's DM mixer"
  - "2026-10-22: TalkPress holds per source (the /play button and Space share one press); isTypingTarget lives in lib/floor.ts"
  - "2026-10-22: Review fixes: room mic open while enrolling (FloorView.enrolling), TalkPress resets when push-to-talk goes off, inRoom by socket origin (Hub.inRoom), per-socket press throttle (PTT_MIN_GAP_MS), host POST /api/floor/release (freeFloor)"
  - "2026-10-22: Floor auto release re-arms if its timer fires early; late release announced; campaign switch clears the floor"
  - "2026-10-22: Push-to-talk floor (game/floor.ts, ptt/floor events, onPtt seat checks, session gate DmHost.outsideFloor, floor first in speaker ID, /table Space and room mic gate, phone hold button, host toggle POST /api/push-to-talk)"
  - "2026-10-21: REALTIME_VAD_EAGERNESS (default low; auto answered players pausing mid-sentence); [turn-timing] gap=, [cutoff] line (bugs/vad-cuts-slow-speakers)"
  - "2026-10-21: Split out of realtime-sideband.md (noise-turn gate, NPC voices, NPC clip queue, NPC close-up, table clip echo gate, table mic mute); history of these sections is in that doc's change_log"
---

# Realtime audio and turns

How the voice DM decides which mic turns to answer and how other voices (NPC and AI player clips)
share the room with it. The call itself, reconnects and instructions are in
[realtime sideband](realtime-sideband.md). Files: `apps/server/src/realtime/noise.ts`,
`npc-queue.ts`, `npc-voice.ts`, `npc-focus.ts`, and the turn handling in `session.ts`.

## Noise-turn gate and turn timing

**Turn end (eagerness).** `semantic_vad` decides when a pause ends a turn. `eagerness` comes from
`REALTIME_VAD_EAGERNESS` (`config.vadEagerness`, default `low`). With `auto` the 2026-10-21
play-test answered half sentences ("I steal", "Gordon.", "Mi") from players who paused to think;
`low` waits longest. Players still can't talk over the DM (`interrupt_response: false`).

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
- `DmHost.onTurnAccepted()` fires whenever a mic turn is answered (gate respond, timeout, failed
  or off), before a slow transcript arrives; the ready check counts human lines there.

Every turn logs greppable lines (`grep turn-timing`), also with the gate off:
`[turn-timing] item=<id> speech=<ms> transcript=<ms after commit> gate=respond|skip|failed|timeout|off`
and, for the turn that was answered, `[turn-timing] item=<id> speech=<ms> audio_start=<ms after
commit>` when the DM's audio starts. `gap=<ms>` is the silence between `speech_stopped` and the
commit (how long eagerness waited). `[cutoff] speech resumed <ms>ms after the DM began answering
item=<id>` marks speech starting within `CUTOFF_WINDOW_MS` (1.5 s) of a reply to a voice turn: the
player was probably still talking. Many of these mean eagerness is too high. Use them to pick `TURN_GATE_TIMEOUT_MS` and to see the
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


## NPC voices

The Realtime output voice cannot change after the session has produced audio. NPCs are therefore
handled in two ways:
1. **Voice direction (always on).** Each outline NPC has a `voice` field (accent, pitch, pace,
   verbal tics). The brain fills it in `generateOutline`. `buildInstructions` prints it as
   `Voice: …` after each NPC, and the persona tells the DM to perform it every time.
2. **`speak_as_npc` (on by default: `NPC_TTS` unless `0`/`false`/`no`/`off`, and needs `OPENAI_API_KEY`).** The tool synthesizes one short line with
   `client.audio.speech.create({ model: NPC_TTS_MODEL, voice, input, instructions, response_format:
   "mp3" })` in `npc-voice.ts`.
   - `voice` is picked from the built-in speech voices by a hash of the NPC name, never the DM's
     `REALTIME_VOICE`. `instructions` is the NPC's voice direction plus the call's `style`. The
     direction comes from `resolveNpcVoice`: the map NPC's `Monster.voice` (`add_npc` `voice`, or a
     generated `defaultNpcVoice(name)`), else the outline NPC's `voice`, else `defaultNpcVoice(name)`;
     it is never empty. Both defaults hash the name alone, so an NPC keeps its voice when `add_npc`
     places it after it has spoken. `defaultNpcVoice` picks pitch, pace, timbre and manner from
     independently mixed hashes (all 6400 combinations reachable). `SpeakAsNpcContext.monsters` carries the game state's monsters for this.
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
     note (`NPC_TTS_NOTE` via `buildInstructions(..., { npcTts })`): voice EVERY quoted NPC line with
     `speak_as_npc` (short lines, one or two sentences), narrate between lines itself, never speak the
     NPC's words in its own voice, and stop talking without repeating the line. Back-to-back clips
     play strictly in reservation order, each as soon as `/table` reports the previous one ended.
   - With the feature off it returns `{ ok: false, error }` so the DM just speaks the line itself.

### NPC clip queue (no overlap with the DM)

- `speakAsNpc` takes its place with `NpcClipQueue.reserve()` **before** awaiting synthesis, so
  several `speak_as_npc` calls in one response (run in parallel) play in call order. A slot is
  freed by `cancel()` when synthesis throws, and dropped after `RESERVE_MAX_MS` (30 s) if never
  filled. `slot.play()` returns false for a dropped slot; `speakAsNpc` then returns `{ok:false,
  error:"NPC voice was too slow; speak the line yourself"}` and doesn't log the line.
  Synthesis itself has a deadline. The client is built with `timeout: NPC_TTS_TIMEOUT_MS` (15 s) and
  `maxRetries: 1`, and `withDeadline` aborts the request and download after twice that. Without it, a
  stalled request could hang for the SDK default of 10 min × 3.
  `enqueue(clip)` = reserve + play.
- The queue broadcasts `{ type: "npc_speech", npcName, line, url, portraitUrl?, pc? }` (the last two
  for an AI player's line: its sprite and `pc: true`, for the TV close-up) only while
  the DM's audio is silent: `GameService`'s `onStatus` calls `setDmSpeaking(status === "speaking")`
  (except for `connecting`, which keeps the last state during a sideband reconnect), i.e.
  it waits for `output_audio_buffer.stopped`/`cleared`. If the DM still reports speaking after
  `DM_SPEAKING_MAX_WAIT_MS` (30 s) the clip plays anyway.
- A `pc` clip (an AI player) also waits while `deps.dmBusy()` (`DmSession.busy`) is true: a response
  running or queued (`responseActive`, `wantResponse`, `afterTools`), someone talking, or a turn
  waiting on the gate. Not `speaking`: `onReplyDone` fires while the reply's audio still plays, and
  the audio wait above covers it. It re-checks every `BUSY_POLL_MS` (250 ms) and is **dropped**,
  never played, after `DM_BUSY_MAX_WAIT_MS` (15 s). NPC clips skip this check: `speak_as_npc` runs
  inside the DM's own response. `NpcSlot.started` resolves true when a clip starts, false if it
  never will. `DmHost.onResponseStart` fires on every `response.created`.
- Clips play one at a time, in order. Each resolves when `/table` POSTs `/api/npc/clip-ended
  {url}` for the playing clip, or after its length + `CLIP_END_GRACE_MS` (1.5 s), so no table,
  a muted table or a lost report never blocks the DM. `stopDm` clears the queue.
- The service passes that promise to `DmSession.holdResponses(done)`: every `response.create`
  (the tool follow-up and any player turn meanwhile) waits until all holds are released (each
  also releases after `DEFAULT_HOLD_MAX_MS`, 60 s), then one merged response is sent.
- [AI players](../gameplay/ai-players.md) use the same queue (`playOnSlot`) with their own voice
  (`NpcVoice.synthesizeWith`), and their line goes to the DM as typed text once the clip played.
  Their hold starts when the clip starts (`slot.started`), not at reserve: a held response would
  keep the DM busy and the clip would wait on itself.
- `/table` (`apps/web/src/lib/npcAudio.ts` `NpcClipPlayer`) plays clips sequentially and reports
  `ended`, `error` and a rejected `play()` as ended. A muted table (or one muted mid-clip) skips
  clips and reports **nothing**, so the first report always comes from a table that played the
  clip; with every table muted, the server's clip-length timeout releases the DM.

## NPC close-up (`npc-focus.ts`)

`npc_focus { npc_name? }` (and `speak_as_npc`) set `GameService.npcFocus` (`NpcFocus`), which
broadcasts `{type:"npc_focus", focus: {name, portraitUrl?} | null}` and repeats it to a client that
connects. `GameService.focusNpc` resolves the name and portrait (`npcFocusView`, see the tool
catalog) and draws a missing portrait on demand, re-sending the focus with it when it's ready. While an NPC has the focus, `DmHost.onDmCaption` forwards the DM's audio transcript as
`{type:"caption", caption: {id, npcName, text, final}}` (pieces, then the whole reply as final);
without a focus nothing is sent. The focus clears on `npc_focus` without a name, a scene change,
`stopDm` (campaign switch) and after `NPC_FOCUS_IDLE_MS` (60 s) without a line. It is not game
state (no undo entry). The persona asks the DM to call it right before speaking as an NPC and to
clear it when the conversation ends. The TV side is in `docs/web/table-display.md`.


## Table clip echo gate (`DmHost.isEcho`)

The TV speaker (NPC and [AI player](../gameplay/ai-players.md) clips) is heard by the shared mic.
`GameService` answers `isEcho(ts)` with `NpcClipQueue.echoAt(ts)`: true while a clip plays and for
`ECHO_TAIL_MS` (400 ms) after it ends. `onCommitted` checks the VAD speech-start time
(`speechStart + SPEECH_LEAD_MS`) and drops an echo turn like a muted one (item deleted, no note,
no reply, transcript not logged, `[echo]` log line). Someone talking over a clip is dropped too.

`DmHost.onReplyDone(text)` is called after every finished reply (no tool calls left), after the
stall/empty nudges; `GameService` runs the AI players from it.

## Push-to-talk floor (`PUSH_TO_TALK`, `game/floor.ts`)

With push-to-talk on (the default; the host toggles it while playing), **everyone, the room included,
holds a button to talk to the DM**. Players talk freely to each other the rest of the time: the DM
never hears it. With it off, the table is an open mic exactly as before (voiceprints, noise gate).

**The floor** (`Floor`, pure, clock injected, `floor.test.ts`): holder `{room: true}` or
`{playerId, inRoom}`, or nobody.
- `press(holder)`: the first press wins; a press while someone else holds it is refused. A repeat
  press by the holder keeps the original start, so key repeat can't dodge the cap.
- `release(holder)`: only the holder. A hold is released on its own after `FLOOR_MAX_HOLD_MS`
  (30 s, a forgotten button); the hold then ends at the cap, not when someone noticed.
- Every hold stays on a short timeline (2 min, ≤100 holds), extended by `FLOOR_TAIL_MS` (600 ms)
  after it ends. `covered(from, to)` = any hold overlaps the window; `holderDuring(from, to)` = the
  holder that overlapped it most. Both constants live in `packages/shared/src/events.ts`.

**Who may press** (`GameService.onPtt`, `ClientEvent {type:"ptt", down, playerId?}` over `/ws`,
validated on the server; the socket's access comes from `Hub.accessOf`):

| Socket | `playerId` | Holder |
|---|---|---|
| `/table` or `/host` hello (table or host access) | none | `{room: true}` |
| Table or host access (a home-network phone under `TRUST_LAN`, hello `player`) | a human seat in the campaign | `{playerId, inRoom}` |
| Player cookie (`level: player`) | none or its own bound seat | `{playerId, inRoom}` |

`inRoom` comes from where the socket connected, not its access level: the upgrade's origin kind
(`auth/origin.ts`, stored by `Hub.add(ws, access, origin)`, read with `Hub.inRoom`) is `local` or
`lan` for a device at the table and `remote` through the tunnel (`cf-connecting-ip`). So with
`TRUST_LAN` off, a home-network phone signed in with the table code still holds the floor in the
room and its hold opens the room mic. A socket added without an origin (in-process callers) counts
a player cookie as remote and anything else as in the room.

Anything else is ignored: another seat, an AI seat, an unknown id, a non-string, a phone without a
seat, and every press while push-to-talk is off. Only the socket that pressed can release; it
releases when that socket closes (or is kicked). A press interrupts a pending AI player line.

**Throttle.** A press within `PTT_MIN_GAP_MS` (250 ms, `game/floor.ts`) of the same socket's last
press or release is ignored (button mashing, a flaky client flapping the floor); a refused press
(someone else holds it) still counts as the last press. Releases are never throttled. The gap is
per socket (a `WeakMap`), after the seat checks, so invalid presses don't start it.

**The host frees the floor.** `POST /api/floor/release` (host only) calls `GameService.freeFloor`:
whoever holds the floor loses it (`releaseFloor`, broadcast, a system line and a `ptt` diag). The
old holder's later release is a no-op, since its socket no longer owns the floor. The Play tab shows
**Free the floor** next to the holder pill.

**Announcing the auto release.** `Floor` applies the cap lazily (any read after it ends the hold
silently), so the service keeps a timer (`armFloorTimer`) that broadcasts once the floor is free. It
re-arms while the hold is still live, because a Node timer can fire a ms or so before `Date.now()`
reaches the cap. A release from the pressing socket after the hold already lapsed is announced too
(bugs/ptt-auto-release-not-announced).

**Events.** `{type:"floor", floor: {pushToTalk, holder, enrolling?}}` is broadcast on every change
and is in the connect snapshot. `enrolling: true` (omitted otherwise) while a voice is being
recorded (`SpeakerService.enrolling`): `startEnrollment` and `finishEnrollment` broadcast it, and a
timer re-broadcasts after `ENROLL_MAX_MS` when a forgotten recording stops counting. It is not secret, so player sockets get it unchanged (`PublicFeed` passes it).
The host toggles with `POST /api/push-to-talk {on}` (host only; runtime, resets to `PUSH_TO_TALK` on
restart). Turning it off, and switching, resetting or deleting the active campaign, clears the floor
and its timeline (`resetFloor`). It is logged as a system line and a `ptt` diag.

**The session gate** (`DmHost.outsideFloor(from, to)`): in `onCommitted`, after the mute and echo
checks, a turn whose speech window `[speech_started − SPEECH_LEAD_MS, speech_stopped]` no hold
(plus tail) covers is dropped exactly like a muted one: `conversation.item.delete`, no speaker note,
no reply, its transcript isn't logged, and a `[ptt] dropped voice turn <id>: nobody held the
push-to-talk floor` line. This catches TV-speaker bleed and side chatter even if audio leaks
through the browser gate. `onUserSpeech(true)` with nobody on the floor is ignored too (no live
who's-talking, no AI interrupt).

**Speaker ID.** The floor holder during the turn's window comes first in `identifySpeaker` and
`liveSpeaker` (note `[speaker: Sam as Lia (push-to-talk)]`, confidence 1). A room hold falls
through to the host's tap, the one-player shortcut and voiceprints ([speaker ID](speaker-id.md)).

**The browser side.** `/table` enables the room mic track only while the room or an in-room player
holds the floor, plus the tail, or while a voice is being enrolled (`floor.enrolling`; the
recording may come from the table mic through `pickAudioSource`) (`lib/floor.ts` `tableMicEnabled` /
`tailAfter`, applied in `useTableVoice` with `applyMicMute`); mute stays a hard override. Words
said while enrolling are not a DM turn: there is no separate enrollment guard in the session, but
nobody holds the floor, so the session gate drops them (with push-to-talk off the table is an open
mic anyway, as before) (bugs/ptt-enrollment-mic-closed). Space on `/table` presses for the
room (`isTalkKey`, repeats ignored, released on keyup and window blur). Phones show a big **Hold to
talk to the DM** button (`player/TalkButton.tsx`), released on pointer up/cancel and when the page
hides, and when push-to-talk is turned off mid-press (`TalkPress.sync`, so the button works again
once it is back on). A remote player's hold keeps the room mic closed; their audio reaches the DM through the
TV's DM mixer ([online call](../web/online-call.md#audio-into-the-dm-appswebsrctabledmmixerts):
their gain is 1 only while they hold the floor, plus the same tail).

**Known limits.** Releasing the button does not end the turn at once: Realtime's VAD still waits
for silence (`REALTIME_VAD_EAGERNESS`), so the tail and the overlap check cover a `speech_stopped`
that comes after the release. With `TRUST_LAN` off, a home-network phone signs in with the code and
still counts as in the room (by origin), so its hold opens the room mic.

## Table mic mute (`setMicMuted`)

A hard mute so the party can talk without the DM hearing. The flag lives in `GameService`
(`setMicMuted`, runtime only; it resets on a server restart) and is pushed to the session with
`DmSession.setMicMuted`, including for a DM started while muted. `/table` disables the call's
mic track (`lib/mic.ts` `applyMicMute`), so normally Realtime gets silence. The session
guards anyway:

- While muted, `speech_started` is ignored (no live who's-talking), and an `input_audio_buffer.committed`
  turn is dropped: its audio item is deleted (`conversation.item.delete`), there is no speaker note
  and no response, and its late transcript is not logged (`mutedItems`). This covers a sentence
  cut off by the mute.
- A reply in flight, or a turn committed before the mute, plays out normally.
- Unmuting adds one system note (private table talk; don't ask about it) and **no** `response.create`:
  the DM waits for the next player.
- Typed input and host whispers are not affected.

## Known limits / TODO

- The noise gate adds the transcription latency (roughly the `transcript=` ms) to every voice
  reply, and responses triggered meanwhile (tool follow-ups) already see the pending audio item.
  Measure with real speech before tuning.
- Timestamps for the speech window come from server wall-clock time around VAD events, not from
  `audio_start_ms`, so alignment is approximate. It is good enough for turns of 0.6 s or longer.
- `speak_as_npc` clips and the Realtime DM's audio both play from `/table`. The
  queue keeps them apart in time, but the model can still start audio in the same response
  before the tool call; that audio finishes first, then the clip plays. Not live-tested yet.
