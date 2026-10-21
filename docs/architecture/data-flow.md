---
title: Runtime data flow
area: architecture
topic: data-flow
related_code:
  - apps/server/src/realtime/session.ts
  - apps/server/src/game/service.ts
  - apps/server/src/game/hostNote.ts
  - apps/web/src/lib/voice.ts
  - apps/web/src/lib/useServer.ts
  - packages/shared/src/events.ts
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-20: Party split: host focus_scene note; commit() normalizes scenes"
  - "2026-10-20: combat_start moment"
  - "2026-10-20: Reviewed for the character roster: roster saves/joins go through GameService (mutate/commit); no flow change"
  - "2026-10-20: pickup event body text; web onPickup listener"
  - "2026-10-20: hostActionNote names map objects; pickup event"
  - "2026-10-20: end_campaign refreshes/notes the live DM"
  - "2026-10-20: useServer onMoment listener for the TV"
  - "2026-10-20: moment events (transient, not in the snapshot)"
  - "2026-10-20: Host tool calls send a silent Host did note to the DM"
  - "2026-10-19: Table mic mute flow"
  - "2026-09-24: Reconnect paths and npc_speech event"
  - "2026-09-24: Initial version"
  - "2026-09-24: effect events"
  - "2026-10-18: DM is no longer interruptible (interrupt_response false)"
  - "2026-10-18: NPC clip queue in the npc_speech flow"
  - "2026-10-18: runTool passes its source (dm|host) to the engine"
  - "2026-10-18: commit/loadCampaign upgrade old characters (rules engine)"
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

If the sideband drops, `DmSession` reconnects with backoff (same `call_id`). If the WebRTC link
drops, `VoiceLink` builds a new call with `/api/dm/voice?resume=1` and the DM resumes instead of
re-greeting. Details: [realtime-sideband](../server/realtime-sideband.md#reconnect-and-idle-watch).

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
server: runTool() for each call in parallel → engine → commit → broadcast state + roll + effect + moment events
server ─► conversation.item.create (function_call_output) × N, then response.create
Realtime ─► speaks the outcome ("The goblin reels — 9 damage!")
```

**Tool source.** `runTool(name, args, source)` is `"dm"` from the voice DM and `"host"` from the
REST API (host laptop, Board tab). The DM is refused host-only tools, and the engine gets the source
as `EngineContext.source` (the host may drop a token on a blocking feature; the DM is redirected).
A host call that changed the state is told to a live DM as a silent system note (`hostActionNote`,
`game/hostNote.ts`: "Host did: …"), so the DM doesn't redo a host spawn or rest. Map-object
calls (`place_interactable`, `set_interactable`, `remove_map_object`) name the object and its id.

**No interruptions.** `interrupt_response: false`: table talk never cuts the DM off mid-sentence.
Speech during narration is still detected, committed, speaker-identified and transcribed, and
`DmSession` queues its `response.create` while a response is active (`wantResponse`), so the DM
answers it right after it finishes. While DM audio plays (`output_audio_buffer.started` until
`stopped`/`cleared`) the status stays `speaking` instead of flipping to listening/thinking.

## Text mode

`/api/dm/text` opens a server-only WebSocket (`?model=`) with `output_modalities: ["text"]`. It
uses the same tools and the same `DmSession` event loop. Typed messages go through
`sendPlayerText(text, speakerNote)`. Use it to test without a mic, or when voice is not wanted.

## Host actions and broadcasting

- Every mutation goes through `GameService.commit(state)`. That saves `game_states`, appends to
  `events`, and broadcasts `{type:"state"}` to every `/ws` client. Before saving, `commit` (and
  `loadCampaign`) runs `upgradeCharacters`, which derives slots, hit dice and resources for any
  character that still has the zeroed defaults of an old save
  ([rules engine](../gameplay/rules-engine.md)).
- Dice results are also broadcast as `{type:"roll"}`, so the table can animate them in order.
- Visual board effects (hits, heals, crits, `play_effect`) are broadcast as `{type:"effect"}` right
  after the state. They are transient: not stored and not in the connect snapshot.
- Table moments (victory, defeat, fled, death, revived, turn_start, combat_start, campaign_end) are broadcast as
  `{type:"moment"}` after the state and effects (`EngineOutcome.moments`; `end_campaign` sends its
  own, refreshes the DM's instructions and, when the host ends it, notes the live DM). Also transient: not stored, not in the event log, not in the connect snapshot. On the web,
  `useServer` hands each one to an `onMoment(moment, latestState)` listener; `/table` plays it
  ([table display](../web/table-display.md#moments)), a reload shows nothing old.
- A successful `pick_up` is broadcast as `{type:"pickup", pickup}` (`EngineOutcome.pickups`: who,
  items with icons, gold). Transient like moments; `useServer` hands it to `onPickup` and `/table`
  shows a toast ([table display](../web/table-display.md#layout-tablepagetsx)).
- Slow work (outline writing, maps, sprites, recaps) is wrapped in `job()`. That emits `{type:"job"}`
  as running, then done or error, which drives the spinners on both screens.
- A new socket gets a snapshot right away (`campaign`, `dm_status`, `mic`, `state`).
- Table mic mute: `/api/mic` (host, TV) or `/api/players/:id/mic` → `GameService.setMicMuted` →
  `{type:"mic"}` to everyone and `DmSession.setMicMuted`. `/host` then disables the shared mic track,
  so neither the WebRTC DM nor `/ws/audio` hears anything (the server also drops audio while muted).
- `speak_as_npc` queues its clip (`NpcClipQueue`). `{type:"npc_speech", url}` goes out only while
  the DM's own audio is silent; `/table` plays it (`NpcClipPlayer`) and POSTs
  `/api/npc/clip-ended`, and the DM's next response waits for that (or a timeout).

Event types live in `packages/shared/src/events.ts`.
