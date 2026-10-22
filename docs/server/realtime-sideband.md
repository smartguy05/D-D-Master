---
title: Realtime voice DM and sideband
area: server
topic: realtime
related_code:
  - scripts/session_log.py
  - apps/server/src/realtime/watch.ts
  - apps/server/src/realtime/session.ts
  - apps/server/src/realtime/instructions.ts
  - apps/server/src/realtime/*.test.ts
  - apps/web/src/lib/voice.ts
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Opening runs an active character build first; restore note carries it"
  - "2026-10-22: [ptt] lines are saved as diag events too"
  - "2026-10-22: /api/dm/voice needs table access; a 401 on the offer goes to sign in"
  - "2026-10-21: Board watcher (watch.ts): a reply that narrates a move or a departure with no move tool gets one [watch] nudge; move_party shares the move cap; session log lines saved as diag events (bugs/dm-no-exploration-moves, bugs/scene-advance-narrated-only)"
  - "2026-10-21: Split: noise-turn gate, NPC voices/clip queue/close-up, echo gate and mic mute moved to realtime-audio-and-turns.md (doc hit 500 lines)"
  - "2026-10-21: Persona: move_token routes by itself, narrate only its result, ignore_terrain as the final rules authority; CURRENT LOCATION names the real entrance (bugs/move-narrated-through-wall)"
  - "2026-10-21: DmSession.busy + DmHost.onResponseStart; AI player (pc) clips wait while the DM is busy and drop after 15 s (bugs/ai-player-talks-over-dm); the browser call runs on /table (voice-ownership.md, bugs/closing-host-kills-dm)"
  - "2026-10-21: 60 min call cap and planned handover (voice-handover.md); isQuiet, seedHandover, close({quiet}), owner guards; onTurnAccepted for the ready check"
  - "2026-10-21: A silent voice reply resets status to listening; no empty-follow-up nudge once the campaign is over (campaignOver); stopTalking resets a stale thinking; npc_speech carries portraitUrl/pc (bugs/dm-stuck-pondering-after-campaign-end, bugs/ai-player-no-closeup)"
  - "2026-10-21: [tool] log line for refused/failed tool calls; speech synthesis deadline (NPC_TTS_TIMEOUT_MS)"
  - "2026-10-21: Persona: ask players before change_scene; AI player suggestions to leave are not decisions"
  - "2026-10-20: Echo gate (isEcho / NpcClipQueue.echoAt), onReplyDone hook, AI player clips and AI PLAYERS instructions block"
  - "2026-10-20: Party split: SPLIT PARTY persona section, CURRENT LOCATION (IN FOCUS), OTHER GROUPS block, away tags in PARTY"
  - "2026-10-20: Persona: never end_campaign for one PC death; Death rule line; auto-end system note"
  - "2026-10-20: Review fixes: NPCs here refreshed after creature/attitude tools; name-only default voice with independent components"
  - "2026-10-20: NPC_TTS on by default; speak_as_npc for every NPC line; voice resolution (Monster.voice > outline > default); Influence/attitude persona and NPCs here block"
  - "2026-10-20: Objects here block; interactive feature tag; persona lines for drop_loot/pick_up/place_interactable/set_interactable"
  - "2026-10-20: Instructions state a finished campaign (CAMPAIGN COMPLETE / ENDED); host end_campaign is told to the DM"
  - "2026-10-20: Persona: end_combat outcome, victory_hint, end_campaign"
  - "2026-10-20: Instructions refreshed after set_door and edit_walls (door list)"
  - "2026-10-20: Instructions list the scene's doors and the wall/cover/set_door rules"
  - "2026-10-20: Empty tool follow-up nudge; end-of-combat stall prompt"
  - "2026-10-20: Silent host-action notes (hostActionNote); physical note says already recorded"
  - "2026-10-19: Persona: turn-limit bullet; move cap vs turn economy"
  - "2026-10-19: Table mic mute: setMicMuted drops turns committed while muted; unmute note without a reply"
  - "2026-10-19: NPC close-up: npc_focus, onDmCaption captions, NpcFocus"
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
  - "2026-10-19: Persona: fog comes from the location; set_fog only overrides"
---

# Realtime voice DM and sideband

Files: `apps/server/src/realtime/session.ts`, `instructions.ts`, and the browser side
`apps/web/src/lib/voice.ts`, run by `/table` ([voice ownership](voice-ownership.md)).

## Call setup (WebRTC + sideband)

- `createVoiceCall(host, offerSdp)` calls `client.realtime.calls.create({ sdp, session })` in the
  openai SDK v7. It sends a multipart POST to `/v1/realtime/calls` with an `sdp` part and a
  `session` JSON part.
- The response body is the SDP answer. The call id is the last path segment of the `Location` header.
- `DmSession.connect()` in voice mode opens `wss://api.openai.com/v1/realtime?call_id=<id>`, with
  `Authorization: Bearer OPENAI_API_KEY`. The `model` is ignored, since it was already set on the call.
- In text mode it opens `?model=<REALTIME_MODEL>` and sends `session.update` with
  `output_modalities: ["text"]`.

The API key never leaves the server. The browser just POSTs its SDP offer to our `/api/dm/voice`. That route needs table access (this machine, the home network or the host cookie; a 401 sends the page to `/login`), so a remote player can't start a call on the server's key ([authentication](auth.md)).

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
// telling the model not to repeat what was cut off. With nothing in flight it returns false and
// resets the status to listening (a stale "thinking" orb).
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
| `input_audio_buffer.committed` | `host.identifySpeaker(start,end)` → speaker note (with our own item id) → noise-turn gate ([realtime audio and turns](realtime-audio-and-turns.md)), or `requestResponse()` when the gate is off |
| `conversation.item.input_audio_transcription.completed` | Gate decision; `onPlayerText(transcript, label)` (logged) unless skipped |
| `conversation.item.input_audio_transcription.failed` | Gate: answer the turn anyway |
| `response.created` | `responseActive = true`, status `thinking` |
| `output_audio_buffer.started` / `stopped` / `cleared` | status `speaking` / `listening` |
| `response.done` (no tool calls) | status `listening` in text mode, and in voice mode when the reply had no speech and no audio is playing (a silent follow-up, a cancelled or failed response): nothing else would clear `thinking` |
| `response.output_audio_transcript.delta` | `onDmCaption(item_id, delta, false)` (NPC subtitles) |
| `response.output_audio_transcript.done`, `response.output_text.done` | `onDmText` (logged); the audio transcript also goes to `onDmCaption(item_id, transcript, true)` |
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
`stalledTurn` also returns an end-of-combat prompt (key `end:<order>`) while combat is active and
no foe (`!ally && !neutral && hp > 0`) is standing: "call end_combat now". Not before any foe
was on the map, and not while a PC is dying (ending combat would stop the automatic death saves).

**Empty tool follow-ups.** The response that answers tool outputs (`afterTools`) can come back with
no speech and no calls (a half-applied Magic Missile, no `next_turn`). `nudgeEmptyFollowUp` then
prompts: "Finish resolving the last action … then speak to the table". At most
`MAX_EMPTY_NUDGES` (2) until the DM speaks again, and never twice in a row (the nudge's own reply
is not a tool follow-up). Logged as `[stall] empty reply after tool outputs`. Skipped when
`host.campaignOver()` (the campaign is completed or failed): a finished story has nothing left to
resolve, and the nudge only produced more silent replies.

**Move cap.** A reply is a chain of tool rounds until the DM speaks without calling a tool. Within
one, `refuseMove` lets each `entity_id` take `MAX_MOVES_PER_REPLY` (2) `move_token` calls. Later
calls aren't run and return `{ error: "…already moved twice…" }`, with a `[moves]` log line. The
count resets when the reply ends or a batch contains `next_turn`. This stops a hunt for a cell that
keeps getting redirected: one play-test had 80 moves around a lever. The persona also says that
furniture is used from beside it. The engine's [turn economy](../gameplay/turn-economy.md) also
refuses moves past a creature's Speed in combat; the cap stays as a guard against loops.

**Board watcher** (`realtime/watch.ts`, pure, tested with lines from the 2026-10-21 play-test).
When a reply chain finishes, `watchBoard` checks the player line it answered and everything the DM
said in it. A player's "I head to…/we go down…" or the DM's "makes his way to…/you all descend…",
with no `move_token`, `move_party`, `change_scene` or `focus_scene` in the chain, gets one system
note: "[Board check: … call move_party or move_token now …]". When the text names another outline
location ("the graveyard beyond") the note says to call `change_scene <id>` (ready check) instead.
At most one per player line (`watchNudged`); skipped in combat (its own loop) and after the
campaign ends. The fix may end silently: an empty follow-up after it is not nudged again. Logs
`[watch] move|travel: <cue>`. `DmHost.watchScene()` gives combat state and the other locations.
`move_party` counts as one mover (`party`) for the move cap.

**Tool log.** Every tool call whose output has an `error` (a refusal from walls, turn economy, scene
focus, the move cap or the ready check, or a thrown error) logs `[tool] <name>(<entity id>) -> <error>`.
Grep for it when the DM "stops moving tokens".

**Saved diagnostics.** `GameService` wraps the session's `log`/`warn` so every line is also saved
as a `diag` event `{tag, text}` (`[tool]`, `[moves]`, `[stall]`, `[watch]`, `[echo]`, `[ptt]`,
`[turn-timing]`, `[cutoff]`). Every `tool` event carries its outcome (`ok`, `error` or a 300-char
`result`, `ms`); `diag` also records `board` (PC cells and revealed fog after `change_scene` /
`move_party`), `job` errors (with the API error code), `image` rewordings and `mic` toggles with
their source. Read a session with `python3 scripts/session_log.py [campaign] [--since HH:MM]
[--only tool,diag]`.

## Noise-turn gate, NPC voices, echo gate and mic mute

These moved to [Realtime audio and turns](realtime-audio-and-turns.md): the noise-turn gate and
`[turn-timing]` logs, NPC voices (`speak_as_npc`, TTS, default voices), the NPC clip queue, the
NPC close-up, the table clip echo gate (`DmHost.isEcho`) and the table mic mute (`setMicMuted`).

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

### Planned handover (60 min cap)

A Realtime call ends at 60 minutes. Past `VOICE_HANDOVER_AFTER_MS` (50 min) the server builds a
standby call at a quiet moment (`DmSession.isQuiet()`, no NPC clip, no busy AI player) and swaps
to it silently (`seedHandover(note)`, `close({ quiet: true })`), at the latest at
`VOICE_HANDOVER_DEADLINE_MS` (57 min). **Owner guards:** a `dmHost(owner)` whose session isn't the
live DM ignores `runTool` (it returns an error) and the other callbacks. See
[voice-handover.md](voice-handover.md).

### Browser side (`VoiceLink`, on `/table`)

The call runs on `/table` (`table/useTableVoice.ts`); `/host` only sends commands and sees the
state through `voice_owner` (see [voice ownership](voice-ownership.md)). `VoiceLink` watches
`RTCPeerConnection.connectionState`: `failed` rebuilds the call at once, `disconnected` gets
`DISCONNECT_GRACE_MS` (5 s) first. A rebuild POSTs a new offer to `/api/dm/voice?resume=1`, now and
after 1, 2 and 4 s (`RECONNECT_DELAYS_MS`), then the state is `failed` with `error`. `resume(stream)`
does the same for a reloaded table (state `reconnecting`). `startVoice(offer, resume=true)` replaces
the old DM session and calls `DmSession.resume()`: a recap note and one short "I'm back" line
instead of the greeting. States: `idle | connecting | connected | reconnecting | failed`
(`subscribe()`), reported to the server as `voice_link`. The host's PlayTab shows the "voice link"
pill, **↻ Reconnect** (`/api/dm/voice/reconnect`) and the **lost-call banner** (`host/lostCall.ts`:
link `connected` but the server DM `offline` for `LOST_CALL_GRACE_MS`, 3 s). Peer creation, the
offer POST and audio playback are injectable (`VoiceLinkDeps`; `voice.test.ts`).

## Instructions (`instructions.ts`)

`buildInstructions` concatenates:
- The **persona** (voice style, speaker-note handling, mechanics-through-tools rules, when to use
  fog of war (locations start fogged per `Location.fog` on `change_scene`; `set_fog` only to change
  it mid-scene, `reveal_area`, `set_monster_hidden` for ambushes), staging spawns
  (`spawn_monster` `near` a named feature, `formation`, `hidden: true` for an ambush), a Spectacle
  line (attacks and spells animate by themselves: pass `target_id`/`attack_name` on attack rolls and
  `source_id` on `apply_damage`; `play_effect` only for extra moments), whole monster/ally turns
  in one reply (never end a reply announcing a monster's turn), `add_npc` for NPCs who join,
  follow or fight beside the party, ending fights with `end_combat` and an outcome (victory on a
  `victory_hint`, fled, defeat), `end_campaign {outcome, epilogue}` only when the whole story is
  over (never for one fight or one PC's death: a dead PC can be revived; the server ends it on the
  death rule), and
  one compact bullet for the rules engine: `cast_spell`, `short_rest`/`long_rest`, `level_up`,
  `use_resource`, with death saves and concentration checks automatic).
- The adventure title and hook, the acts, and the location ids (for `change_scene`).
- **Party split** ([party split](../gameplay/party-split.md)): the persona's `SPLIT PARTY` section
  (`change_scene` with `character_ids`, cut with `focus_scene`, finish the round first, refusals,
  regrouping). While split: `CURRENT LOCATION (IN FOCUS)`, an `OTHER GROUPS` block (one
  `otherGroups()` line per group, frozen fights included) and `[at <place>, not in focus]` on away
  PCs in PARTY. `change_scene`/`focus_scene` refresh the instructions.
- When `Campaign.status` is `completed` or `failed`: a `CAMPAIGN COMPLETE` / `CAMPAIGN ENDED` line
  (wrap up, no new scenes, no second `end_campaign`). `endCampaign` refreshes the instructions, and a
  host-called one also adds a `Host did: end_campaign…` system note. While `active`: a `Death rule:`
  line for `Campaign.deathRule` (fails only when every PC is dead, or on the first PC death). An
  automatic death-rule end adds a system note to the live DM.
- The **current location** (grid size, axes, and that the party enters from the left edge with the
  far end on the right), its **map features** with grid cells (`describeFeatures(effectiveFeatures(state, loc))`, so the
  host's Board-tab fixes win; tags `focal`, `lit`, `blocks`, `interactive`, e.g.
  `- altar (focal, lit): x 12-16, y 1-3`), its **doors** when it has any ("Doors here", each id,
  edge position and open/closed, from `effectiveWalls`) with the wall rules (attacks need line of
  sight, cover adds +2/+5 AC automatically, `set_door` when someone opens or closes a door,
  `move_token` routes around walls, narrate only its result, `ignore_terrain` for rulings), its **map objects** ("Objects here": each loot
  pile or interactable of this location with id, kind, name, cell, contents and `hidden`/`used` tags;
  refreshed after a changed `drop_loot`, `pick_up`, `place_interactable`, `set_interactable` or
  `remove_map_object`), and its planned encounters, plus the NPCs, each with its `Voice:`
  direction when set.
- With `npcTts`, the note to voice every quoted NPC line with `speak_as_npc`.
- **NPC attitudes and Influence** (persona): the 2024 attitudes on a -5..+5 score, `adjust_attitude`
  after meaningful interactions (gifts, help, insults, threats, won/failed Influence checks),
  `set_disposition` only for sudden hard flips, and the SRD Influence action (Willing: no check;
  Unwilling: no check, refuses; Hesitant: Persuasion/Deception/Intimidation/Performance, Animal
  Handling for Beasts/Monstrosities, DC 15 or the creature's Intelligence, whichever is higher;
  Advantage if Friendly, Disadvantage if Hostile; no retry the same way for 24 hours).
- **NPCs here**: every creature with a token on the map, `- Name (id): Friendly (+3)` (from
  `attitudeOf`, so old saves show derived values; `[down]`/`[hidden]` tags). Refreshed after a
  changed `adjust_attitude`, `set_disposition`, `add_npc`, `spawn_monster` or `remove_monster`
  (DM or host).
- The **last session recap**.
- The **party block**: ids, class (and subclass), AC, HP, modifiers, skills, attacks, each player's
  dice mode, and a compact rules tail (`rulesSummary`: `slots 1:2/4 2:0/3; pact L3 1/2; HD 4/5 d6;
  conc Bless; DOWN saves S1 F2; Rage 2/3`, left/max). Resource notes are left out to keep it short.
- While a build is running (`state.builder`), a **CHARACTER BUILDER ACTIVE** block with the draft
  and the missing fields. The persona's *NEW CHARACTERS* section explains the interview flow
  (`start_character_builder` → `draft_character_update` → `finalize_character`) and how to handle
  phone-roll notes.

`refreshInstructions()` sends `session.update` after a scene change or a roster or character
change, after `edit_map_feature`, `set_door` and `edit_walls` (the feature and door lists), and
after a changed creature or attitude tool (the NPCs here list). HP is not pushed on every hit; the model calls `get_party_status` when it needs it.

`openingPrompt` asks for a recap, or for a hook and scene-setting, then "what do you do?". If a
character build is active (`state.builder`), the opening runs the interview first and holds back
the hook until `finalize_character` (see [characters](../gameplay/characters.md)). The host's
`recentContext` adds the build status, so `restoreNote` (text reconnect, `resume()`) keeps it too.

## Other ways to talk to the DM

- `sendPlayerText(text, note)` handles typed player input, in text mode or while voice is live.
- `resume()` continues after the browser rebuilt the WebRTC call (see above).
- `prompt(note)` sends a host whisper (`/api/dm/whisper`) or a physical-roll notification as a
  system note, followed by a response. `GameService.notifyDm(text)` wraps it; it returns false
  when no DM is running. It is used for phone rolls, physical totals and builder start/cancel. The physical-total note
  says the roll is already recorded, so the DM doesn't call `record_physical_roll` again.
- Host tool calls: `GameService.runTool(name, args, "host")` adds a silent `addSystemNote` (no
  response) built by `hostActionNote` (`game/hostNote.ts`): "Host did: spawn_monster name=Ogre
  … (now on the scene: Ogre)". Only for calls that changed the state; `playerRoll` and
  `submitPhysicalRoll` pass `noteDm: false` (they have their own note); `edit_fog`, `move_token` and
  `edit_map_feature` are too chatty to note. A `roll_dice` note includes the result.

## Known limits / TODO

- A voice sideband reconnect only works while the WebRTC call itself is alive. If the call is gone,
  the retries fail and the browser's `VoiceLink` (or the host's Reconnect button) builds a new call.
- After a restart re-attach, tool calls that were in flight when the server died get no output;
  the model is told so in `RESTART_NOTE`. Not live-tested yet.
