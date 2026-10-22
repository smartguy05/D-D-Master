# Bug: before the first floor event the DM heard every remote mic
Status: fixed (2026-10-22)
Area: web

## Overview
With push-to-talk on, the DM still heard every remote player's voice from the moment the TV loaded
(or reconnected) until the server's first `floor` event.

## Repro
Push-to-talk on, a remote player in the call talking; reload /table. Until the `floor` event lands,
`view.floor` is null and every remote gain is 1.

## Root cause / Fix
`gainPlan` (apps/web/src/table/dmMixer.ts) used `open = !o.floor || !o.floor.pushToTalk`, so a null
floor counted as push-to-talk off. Fix: `open = !!o.floor && !o.floor.pushToTalk`. `useTableVoice`
re-runs `applyFloor` on every `view.floor` change, so the voices open as soon as a floor with
push-to-talk off arrives. Tests in dmMixer.test.ts ("no floor yet…", "stays silent until the floor
arrives…").

## Notes
Found in the Phase C review of PR #1 (online play).

## TODOs

## Completed
- 2026-10-22: Fixed.
