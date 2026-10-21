# Feature: AI players
Status: done (vertical slice)
Docs: docs/gameplay/ai-players.md, docs/server/realtime-sideband.md ("Table clip echo gate")

## Overview
A seat at the table can be played by an LLM (`Player.ai`). After every finished DM reply the
`AiPlayerController` (`apps/server/src/players/ai-player.ts`) picks at most one AI seat. The
reasons are its combat turn, being addressed by name, a party-wide question, or an occasional
unprompted line after a cooldown. It prompts the model with the character sheet, the board
(`partyStatus`) and the last 40 transcript entries. The line plays on `/table` in the seat's own
speech voice, then goes to the DM as a typed player line (`sendText`).

## Notes
- Decisions (user, 2026-10-20):
  - free text to the DM, no tool calls by the AI
  - the DM rolls for AI players (persona AI PLAYERS block; never request_player_roll)
  - own model config `AI_PLAYER_*`
  - any number of seats, toggled per player, with a persona
  - host controls are Pause and Nudge only (no approval step, no shown reasoning)
- Rejected:
  - letting the DM "hear" the AI's audio through the mic (unreliable transcription and voice ID)
  - AI-run mechanics (move_token etc.)
- The line plays first and the text is sent after the clip ends, so the DM answers after the table
  heard it. If TTS is off or fails, the text is still sent. Speech is time-limited: the TTS deadline
  (`NPC_TTS_TIMEOUT_MS`) and `AI_SPEAK_MAX_MS` (90 s). A hung speech request once muted the seat for
  minutes (bugs/ai-player-goes-mute.md).
- Echo: the TV clip is heard by the shared mic → `NpcClipQueue.echoAt` + `DmSession.onCommitted` drop
  voice turns that start during a clip (+400 ms). This also fixes NPC clips
  (bugs/npc-clip-mic-echo.md). Trade-off: a person talking over a clip is dropped too.
- "Addressed" is a heuristic. A sentence with the name must be a question, open with "Name," or say
  "your turn"/"you're up". Otherwise plain narration ("Thorin's axe…") would trigger a model call
  on every reply.
- Stale guard: a line is dropped if any log entry was added or the combat turn changed while the
  model thought. Nudge checks only the turn.
- The table has the floor (2026-10-21, bugs/ai-player-talks-over-dm.md): the stale guard alone
  missed a human turn with no log entry yet. Now `host.tableBusy()` (`DmSession.busy`) blocks a new
  model call and drops a ready line; `interrupt(reason)` (on `onResponseStart` and on
  `onUserSpeech(true)` unless it's the clip's echo) aborts an unheard line; pc clips wait on a busy
  DM in the queue and drop after 15 s. A line already playing is heard out and still sent. Dropped
  lines don't spend the combat turn; log `[ai] <name>: line dropped (<reason>)`.
- The DM's response hold for an AI clip starts at clip start (`slot.started`), not at reserve:
  holding at reserve queues responses → `busy` → the clip waits on itself (deadlock).
- The speaker-ID one-player shortcut (identifySpeaker and liveSpeaker) ignores AI players.
- Leaving a place needs a human: the DM's change_scene is refused with a ready check until a human
  player speaks (`game/readyCheck.ts`, `GameService.humanInputs`); AI typed lines don't count
  (bugs/ai-player-leaves-without-party.md). One human answer is enough: on one shared mic, demanding
  an answer from each player would hang on voice-ID misses.

## TODOs
- [ ] Live-test with real speakers: is the echo window long enough (TV latency, reverb), and does
      dropping talk-over hurt?
- [ ] Live-test latency: model + TTS per line; tune the AI_PLAYER_MODEL defaults
- [ ] Tune how chatty `spontaneous` feels (cooldown, prompt)
- [ ] Optional: an AI on the far side of a party split (it stays silent while its scene is unfocused)
- [ ] Live-test the ready check: does the DM ask naturally, and does it overuse forced=true?
- [ ] Live-test the AI close-up: does it fight an NPC focus the DM just set (fast back-and-forth)?
- [ ] Optional: the AI answers a DM roll request for its physical/virtual dice itself
- [ ] Live-test the floor rules on real hardware: are AI lines dropped too often in a chatty
      table (grep `[ai]`)? The VAD/WebRTC latency window (a few hundred ms) is not covered.

## Completed
- 2026-10-21: AI lines never talk over the DM or a person: `DmSession.busy`, `onResponseStart`,
  `tableBusy`, `interrupt()`, pc clips wait/drop in `NpcClipQueue`, `NpcSlot.started`, hold from
  clip start, Nudge refused while busy (bugs/ai-player-talks-over-dm).
- 2026-10-21: Ready check fixes: a pending check expires (5 min / 8 human lines) and is cleared on
  any party move, load or new DM session (bugs/ready-check-stale-pending); a voice "yes" counts
  when its turn is answered, not when the transcript lands (bugs/ready-check-late-yes).
  `AiPlayerController.busy` getter (the voice handover waits for it); a line that hit
  AI_SPEAK_MAX_MS aborts its clip (`speak(seat, line, signal)` → `playOnSlot` cancels the slot),
  so the late audio no longer plays after the DM got the text.
- 2026-10-21: AI lines take the TV close-up (sprite, name plate, subtitles); bugs/ai-player-no-closeup.
- 2026-10-21: Speech can't block the line (TTS deadline, AI_SPEAK_MAX_MS); bugs/ai-player-goes-mute.
- 2026-10-21: change_scene ready check; AI prompt: suggest leaving, never decide it.
- 2026-10-20: Player.ai/aiPersona/aiVoice/aiPaused; AiPlayerController + tests; createAiPlayerProvider;
  NpcVoice.synthesizeWith + pickAiVoice; echo gate; onReplyDone hook; AI PLAYERS instructions;
  host Party (Add AI player, AI checkbox, persona) and Play (status, Pause, Nudge); nudge route.
