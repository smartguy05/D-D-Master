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
  heard it. If TTS is off or fails, the text is still sent.
- Echo: the TV clip is heard by the shared mic → `NpcClipQueue.echoAt` + `DmSession.onCommitted` drop
  voice turns that start during a clip (+400 ms). This also fixes NPC clips
  (bugs/npc-clip-mic-echo.md). Trade-off: a person talking over a clip is dropped too.
- "Addressed" is a heuristic. A sentence with the name must be a question, open with "Name," or say
  "your turn"/"you're up". Otherwise plain narration ("Thorin's axe…") would trigger a model call
  on every reply.
- Stale guard: a line is dropped if any log entry was added or the combat turn changed while the
  model thought. Nudge checks only the turn.
- The speaker-ID one-player shortcut (identifySpeaker and liveSpeaker) ignores AI players.

## TODOs
- [ ] Live-test with real speakers: is the echo window long enough (TV latency, reverb), and does
      dropping talk-over hurt?
- [ ] Live-test latency: model + TTS per line; tune the AI_PLAYER_MODEL defaults
- [ ] Tune how chatty `spontaneous` feels (cooldown, prompt)
- [ ] Optional: an AI on the far side of a party split (it stays silent while its scene is unfocused)
- [ ] Optional: the AI answers a DM roll request for its physical/virtual dice itself

## Completed
- 2026-10-20: Player.ai/aiPersona/aiVoice/aiPaused; AiPlayerController + tests; createAiPlayerProvider;
  NpcVoice.synthesizeWith + pickAiVoice; echo gate; onReplyDone hook; AI PLAYERS instructions;
  host Party (Add AI player, AI checkbox, persona) and Play (status, Pause, Nudge); nudge route.
