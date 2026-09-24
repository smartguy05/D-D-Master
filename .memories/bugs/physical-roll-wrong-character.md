# Bug: Physical roll total could be recorded for the wrong character
Status: fixed (2026-09-24)
Area: server

## Overview
`POST /api/rolls/physical` took an optional `characterId` but always used the **pending** roll's
notation, label and DC, and `record_physical_roll` always clears `pendingRoll`. A total sent for
character B while A's roll was pending was recorded as B's "A's label" roll, and it cleared A's
prompt. The route had no player check at all, which mattered once phones could post totals.

## Repro
1. `request_player_roll` for Lyra (physical dice). This sets `pendingRoll`.
2. `POST /api/rolls/physical {total: 20, characterId: <Thorin>}`.
3. Thorin gets Lyra's "Arcana check" and Lyra's prompt disappears.

## Root cause / Fix
There was no authorization. `apps/server/src/game/player.ts` `authorizePhysicalRoll` now does this:
- A phone (`playerId`) can only answer its own character's pending roll.
- The host defaults to the pending character, and a different `characterId` is refused while a
  roll is pending.
- It still works with no pending roll plus an explicit `characterId` (the old behavior).

Totals are validated as integers from -20 to 200 (`parseTotal`), where the route used to send
`Number(undefined)` = NaN. The route logic moved to `GameService.submitPhysicalRoll`. Tests are in
`apps/server/src/game/player.test.ts`.

## Notes
The host can still record a roll for any character with the `record_physical_roll` tool directly.
That tool clears `pendingRoll` unconditionally, which is acceptable for a deliberate host action.

## TODOs
- [ ] Consider making `record_physical_roll` only clear `pendingRoll` when the character matches.

## Completed
- 2026-09-24: Authorization and total validation added.
