# Bug: NPC clips on the TV echo into the shared mic
Status: fixed (2026-10-20)
Area: server (realtime)

## Overview
`speak_as_npc` clips play on the `/table` TV, which is a different device from the host laptop
that captures the mic. Browser echo cancellation only cancels audio played in the same tab, so
the clip could be picked up as a player voice turn. It was then transcribed, given a speaker
note, and answered by the DM after the clip's hold.

## Repro
1. Put the TV speaker near the table mic.
2. Let the DM voice an NPC line with speak_as_npc.
3. The log shows a "player" line repeating the NPC's words, and the DM replies to it.

## Root cause / Fix
Nothing dropped mic turns committed while a clip played: the queue only kept clips and the DM's
voice apart, and `holdResponses` only delayed the reply. The fix:
- `NpcClipQueue` records each clip's play window and exposes `echoAt(ts)`, which covers the
  clip plus `ECHO_TAIL_MS` (400 ms).
- `DmHost.isEcho` exposes that check to the session.
- `DmSession.onCommitted` drops a turn whose VAD start falls in the window, the same way it
  drops a muted turn.

## Notes
Found while planning AI players, whose voice plays the same way. The trade-off is that a person
talking over a clip is dropped as well.

## TODOs
- [ ] Live-test the window with real speakers. (see general/live-test-checklist.md)

## Completed
- 2026-10-20: echo gate + tests (session.test.ts, npc-queue.test.ts).
