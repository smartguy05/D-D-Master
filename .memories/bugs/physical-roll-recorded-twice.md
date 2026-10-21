# Bug: a physical roll entered on the phone/host is recorded twice
Status: fixed (2026-10-20)
Area: server (game service, persona)

## Overview
When a physical-dice player answers a pending roll on the phone pad (or the host types it on the
Play tab), the roll is recorded by the host path and then the DM calls `record_physical_roll`
again with the same total. The table log shows "X rolled …: 17 (physical)" twice, the roll is in
`state.rolls` twice and there are two undo entries.

## Repro
Test run 2026-10-19, 4 out of 4 physical rolls: events 343/344 (phone pad), 420/421 (host *Enter
roll*), 550/551 (phone, natural 20), 627/628 (`POST /api/players/:id/physical-roll`). Each pair is
`source: "host"` then `source: "dm"` < 1 s apart.

## Root cause / Fix
`GameService.submitPhysicalRoll` (`game/service.ts` ~816) runs `record_physical_roll` and then
notifies the DM with `Host note (do not read aloud): {result} - the player rolled physical dice;
continue.` The note never says the roll is already recorded, and the persona
(`realtime/instructions.ts:21`) tells the DM to call `record_physical_roll` for physical rolls. The
handler accepts a record with no `pendingRoll`, so the duplicate goes through.
Fix (shipped), two layers: the host note now says the roll "is already recorded; do not call
record_physical_roll for it again" (`game/service.ts` `submitPhysicalRoll`), and the engine
returns `already_recorded` (no change) for a DM `record_physical_roll` with no pending roll that
repeats that character's last host-recorded physical roll (`RollResult.source` host) within 10 s.
Tests: `rolls.test.ts`, `attack-rules.test.ts`.

## Notes
The duplicate DM call also re-ran the attack effect when it passed `target_id`.

## TODOs
## Completed
- [x] 2026-10-20: Note wording + engine dedupe, with a test
- 2026-10-20: Note says 'already recorded; do not call record_physical_roll'. Engine: DM record with no pending roll repeating the last host-recorded (RollResult.source host) physical roll of that character within 10 s returns already_recorded and changes nothing. Tests: rolls.test.ts, attack-rules.test.ts.
