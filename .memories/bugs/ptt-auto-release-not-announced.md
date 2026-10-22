# Bug: a push-to-talk auto release could go unannounced (clients kept showing the old holder)
Status: fixed (2026-10-22)
Area: server (game/service.ts, game/floor.ts)

## Overview
Found while writing phase 3, before it shipped. `Floor` applies the 30 s auto release lazily: any
read after the cap (`holder`, `covered`, `holderDuring`, e.g. from `identifySpeaker` or the session
gate) ends the hold silently. The service's timer then called `floor.expire()`, which returned
false because the hold was already gone, so no `floor` event went out. The TV kept the room mic open
and phones kept showing "Sam is talking to the DM" until someone else pressed.

## Repro
Press (`ptt down`), move the clock past `FLOOR_MAX_HOLD_MS` without running timers, read
`game.floorView()`, then run the timer: no `floor` event with `holder: null`.

## Root cause / Fix
The timer asked "did *I* just expire it?" instead of "is it free now?". It now broadcasts whenever
the floor has no holder when it fires (`releaseFloor`). Test: service.floor.test.ts ("the auto
release is announced even when something read the floor after the cap first").

Review follow-up (same day, before commit): two more ways it went unannounced.
- The timer was armed for exactly `msUntilExpiry()`, and Node timers can fire a ms or so before
  `Date.now()` reaches the cap. The callback saw a live hold, did nothing and never re-armed.
  `armFloorTimer` now re-arms (`Math.max(1, left)`) while the hold is live.
- The holder's own release after a silent lapse: `floor.release()` found no hold and returned false,
  so nothing was broadcast. The pressing socket's release now also announces when the floor is free.
Tests: "the auto release is announced even when the timer fires a little before the cap" (clock
skewed back 1 ms with `vi.setSystemTime`) and "a release after the hold already lapsed silently is
still announced".

Related, same review: a campaign switch / reset / delete did not clear the floor, so a hold for a
seat of the old campaign kept the TV room mic open. `loadCampaign` and `deleteCampaign` now call
`resetFloor()` (shared with `setPushToTalk`). Test: "switching, resetting or deleting the campaign
frees the floor and tells everyone".

## Notes
- The browser side does not keep its own 30 s timer; it trusts the `floor` event.

## TODOs

## Completed
- 2026-10-22: fixed with a test (online play phase 3).
- 2026-10-22: early-firing timer, late release and campaign switch fixed with tests (review follow-up).
