# Bug: a campaign id "roster" would collide with the roster portrait folder
Status: fixed (2026-10-21)
Area: server (persistence, roster)

## Overview
Roster portraits live in `<dataDir>/roster/assets/` and are served as `/media/roster/<id>.png`
through the campaign media route. Campaign folders are `<dataDir>/<campaignId>/`, and
`Store.deleteCampaign` / `GameService.deleteCampaign` rmSync that folder without checking the id.
A delete call with the id `roster` would wipe every roster portrait.

## Repro
Not reachable through the UI: campaign ids are always `cmp_…`. A hand-made
`DELETE /api/campaigns/roster` (or an imported bundle that somehow kept id `roster`) would do it.

## Root cause / Fix
The roster reuses the campaign media namespace. Fix (2026-10-21): `assertNotRosterId` in
`GameService.loadCampaign` and `deleteCampaign` throws for `ROSTER_MEDIA_ID` with `statusCode: 400`
(so `DELETE /api/campaigns/roster` and `POST /api/campaigns/roster/load` answer 400, before any
rmSync). Defence in depth in `db/index.ts`: `Store.getCampaign("roster")` returns `undefined` and
`Store.deleteCampaign("roster")` throws. Only the exact id is refused (not every non-`cmp_` id), so
old or imported ids keep working. The `/media/roster/...` route is left as is (read-only).

## Notes
Found while implementing the roster (Phase 5, 2026-10-20); left unfixed in that step.

## TODOs

## Completed
- 2026-10-21: [x] Guarded deleteCampaign/loadCampaign and Store get/delete against the `roster` id.
  Tests: `game/service.roster.test.ts` ("campaign id roster is refused": portraits survive),
  `routes/roster.test.ts` and `app.test.ts` (DELETE answers 400).
