# Bug: an AI player goes mute (line shown, never spoken, never sent to the DM)
Status: fixed (2026-10-21); "DM stopped moving tokens" still open, waiting on logs
Area: server (players/ai-player.ts, realtime/npc-voice.ts)

## Overview
In a live session (campaign cmp_04ee010393, 2026-10-21) an AI seat's line showed up on /host with the
"speaking" status, but it never played on the TV and the DM never got it. The AI stayed silent until
the host typed the line by hand. After that, later AI lines spoke again. In the same stretch the DM
kept talking but stopped moving tokens.

## Repro
Make the speech request hang: `audio.speech.create` never answers or stalls mid-body. Then trigger
an AI line (a combat turn or Nudge).

## Root cause / Fix
- `AiPlayerController.run` awaits `host.speak()` and only then calls `host.say()`. `speak` waits on
  `NpcVoice.synthesizeWith`. The client was `new OpenAI({ apiKey })` with SDK defaults: 10 min per
  attempt and 2 retries. `arrayBuffer()` had no deadline either. So a single stalled request:
  - kept the line from the DM,
  - left `busy` set, so every later reply only set `again` and Nudge said "already deciding",
  - and when it finally ended, the 30 s slot had expired: no audio, but the stale line was sent late.
- The TTS files support this: a 6-minute gap in `npc_*.mp3` mtimes (08:23 to 08:29).
- Fix:
  - `NPC_TTS_TIMEOUT_MS` (15 s) client timeout with `maxRetries: 1`.
  - `withDeadline` (2× the timeout) over the request and download, aborting through the request `signal`.
  - `AI_SPEAK_MAX_MS` (90 s) cap on `speak()` in the controller. After it, the controller warns and
    sends the text anyway.
  - `speak_as_npc` uses the same `synthesizeWith`. A stall there would have hung `runTool` and the DM's
    whole tool chain; now it errors, and the DM speaks the line itself.

## Notes
- "DM stopped moving tokens": no evidence survived (no tool events or server log for that campaign).
  No code path links it to the AI hang. Added a `[tool] <name>(<id>) -> <error>` log line for every
  refused or failed tool call (session.ts), so the next occurrence leaves a trail.

## TODOs
- [ ] Next time the DM stops moving tokens: grep the server log for `[tool]`/`[moves]` and find the cause (see general/live-test-checklist.md)

## Completed
- 2026-10-21: TTS client timeout + deadline + abort; AI_SPEAK_MAX_MS; [tool] log. Tests:
  ai-player.test.ts, npc-voice.test.ts, session.test.ts.
