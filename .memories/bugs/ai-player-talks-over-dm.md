# Bug: AI player talks over the DM
Status: fixed (2026-10-21)
Area: server

## Overview
A human spoke, the DM began answering (`response.created`, no audio yet) and an AI player's clip
started playing on the TV anyway, so the AI and the DM talked at the same time.

## Repro
1. Seat an AI player and start the voice DM.
2. After a DM reply (the AI starts deciding a line), a human says something at once.
3. The DM's response is created; before its audio starts the AI's clip plays, then the DM's
   audio starts on top of it.

## Root cause / Fix
Root cause: `NpcClipQueue` only waited while DM audio was playing
(`setDmSpeaking(status === "speaking")`), so the gap between `response.created` and the first
audio was open. The AI's stale guard (a new log entry or turn change) ran once, before TTS, and
a voice turn has no log entry until its transcript lands. AI clips never held DM responses.

Fix:
- `DmSession.busy` getter: `responseActive || wantResponse || afterTools || userTalking` or a
  turn waiting on the noise gate. It leaves out `speaking`, because `onReplyDone` fires while the
  reply's audio still plays (the queue's audio wait covers that). `DmHost.onResponseStart` fires on
  every `response.created`.
- `NpcClipQueue` deps gain `dmBusy()`. A `pc` (AI player) clip waits while busy, polling every
  `BUSY_POLL_MS` (250 ms), and is dropped (never played) after `DM_BUSY_MAX_WAIT_MS` (15 s). NPC
  clips (`speak_as_npc`) are unaffected: they run inside the DM's own response.
  `NpcSlot.started: Promise<boolean>`.
- `AiPlayerController`: `host.tableBusy()`; `interrupt(reason)` aborts the line in flight through a
  per-run `AbortController` (also used for the `AI_SPEAK_MAX_MS` timeout, reason `"timeout"`).
  `run()` skips the model call while the table is busy, drops the line if interrupted or busy
  before speaking, and drops an aborted line not yet heard. A heard or timed-out line still goes
  to the DM. Dropped lines don't spend the combat turn. Nudge refuses while busy. `host.speak`
  returns `Promise<boolean>` (heard); `playOnSlot` awaits `slot.started`. Log line
  `[ai] <name>: line dropped (<reason>)`.
- `GameService`: `onResponseStart` → `aiPlayers.interrupt("the DM is responding")`;
  `onUserSpeech(true)` → `interrupt("someone at the table spoke")` unless `npcClips.echoAt(now)`
  (the clip's own echo). `speakAiLine` holds DM responses (`holdResponses(slot.done)`) from the
  moment the clip starts, not at reserve: a hold queues responses, which makes the DM busy, and the
  clip would wait on itself (deadlock).

## Notes
- Residual: a few hundred ms of VAD/WebRTC latency before `speech_started` reaches the server is
  invisible to it; a clip that starts in that window still plays.
- Docs: docs/gameplay/ai-players.md ("The table has the floor"), docs/server/realtime-sideband.md
  (NPC clip queue).

## TODOs
- [ ] Live-test on real hardware: talk right after a DM reply and check the AI line is dropped
      (grep `[ai]`), and that AI lines still get heard in quiet moments (not dropped too often). (see general/live-test-checklist.md)
- [ ] If the residual latency window shows up live, consider a short pre-roll delay for pc clips. (see general/live-test-checklist.md)

## Completed
- 2026-10-21: `DmSession.busy` + `onResponseStart`, pc clips wait on a busy DM (15 s cap),
  `NpcSlot.started`, AI interrupt/abort, hold from clip start. Tests: session.test.ts,
  npc-queue.test.ts, ai-player.test.ts, service.ai-players.test.ts.
