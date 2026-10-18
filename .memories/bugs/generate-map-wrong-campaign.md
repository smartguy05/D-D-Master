# Bug: generateMap wrote to whichever campaign was loaded when painting finished
Status: fixed (2026-10-18)
Area: server (game/service.ts generateMap)

## Overview
`generateMap` awaits the image API (tens of seconds) and the vision read. Afterwards it called
`this.saveCampaign()`, `this.engineCtx()` and committed against `this.state`. If the host loaded
another campaign meanwhile, that campaign got saved/broadcast with the old campaign's map change
lost, and its game state could be restaged/reset for a location with the same id. Pre-existing
(before the host board work); found by the stream B adversarial review, round 2.

## Repro
`generateMap(loc, true)` (slow image API), then `createCampaign` / `loadCampaign` another
campaign with a location of the same id and a host feature edit; let the paint finish: the new
campaign's `featureEdits` were dropped and a `map repainted` history entry appeared there.

## Root cause / Fix
Everything after the awaits used the *current* service fields. Fix: after the awaits, take the
live campaign only if `this.campaign.id === c.id`; otherwise load `c.id` from the store, set the
location's `mapUrl`/`features` there and `store.saveCampaign` it, with no state changes. The
location is looked up again on the live object (it may have been reloaded or removed).

## Notes
- Test: `apps/server/src/game/service.board.test.ts` "a repaint that finishes after the host
  loaded ANOTHER campaign …".

## TODOs
- [ ] Other long jobs (sprites, pregens) may have the same pattern; audit them.

## Completed
- 2026-10-18: generateMap re-checks the campaign after its awaits.
