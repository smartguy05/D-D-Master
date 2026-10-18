# Bug: host level-up message dropped the engine's note
Status: fixed (2026-10-18)
Area: web (host Party tab)

## Overview
`levelUpOutcome` built the success line from name, level, HP gain and new features only. The
`level_up` result's `note` ("Echo Knight is not the SRD subclass (Champion): add its features by
hand", or "not an SRD class") never reached the host, so the host didn't know to add features.

## Repro
Party tab → Edit a level 2 Fighter → Level up → Other… "Echo Knight" → the message had no note.
Found by the stream D review (round 1).

## Root cause / Fix
The result type lacked `note?`. Fix: `note` appended to the success message. Test in
`apps/web/src/player/sheet.test.ts` ("level-up outcome …"); the server side (`note` returned for a
non-SRD subclass) is checked in `game/service.rules.test.ts` ("host rules UI round trips").

## TODOs

## Completed
- 2026-10-18: Fixed (review round 1).
