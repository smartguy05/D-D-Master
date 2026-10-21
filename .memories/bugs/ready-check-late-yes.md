# Bug: A spoken "yes" to the ready check counted only when its transcript arrived
Status: fixed (2026-10-21)
Area: server

## Overview
`humanInputs`, the ready check's counter, went up in `DmHost.onPlayerText`, which runs when a voice
turn's transcript arrives. With the noise gate, a turn whose transcript is slow is answered on the
`TURN_GATE_TIMEOUT_MS` timeout. The DM then hears "yes" and calls change_scene again before the
transcript lands. The repeat was refused as if nobody had answered, so the DM asked again.

## Repro
1. The DM is refused by the ready check and asks the table.
2. A player says "yes". The transcript takes over 1.2 s, so the turn is answered on the gate
   timeout.
3. The DM's change_scene repeat arrives before the transcript, and it is refused.

## Root cause / Fix
The human line was counted at the transcript, not when the turn was answered. Fix: a new optional
`DmHost.onTurnAccepted()`. `DmSession.answerTurn` calls it for every answered mic turn: respond,
timeout, failed or gate off. A skipped noise turn doesn't count. `GameService` increments
`humanInputs` there, not in `onPlayerText`. `sendText` keeps its own increment for typed lines that
aren't from an AI seat.

Tests:
- `realtime/session.test.ts`: onTurnAccepted fires on the gate timeout before the transcript, and
  not for noise.
- `game/readyCheck.test.ts`: a "yes" answered on the timeout lets the repeat change_scene pass, and
  the late transcript doesn't count twice.

## Notes
Found in the readiness review before the first live session.

## TODOs

## Completed
- 2026-10-21: Fixed.
