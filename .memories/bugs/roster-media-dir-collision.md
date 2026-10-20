# Bug: a campaign id "roster" would collide with the roster portrait folder
Status: open
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
The roster reuses the campaign media namespace. Fix: refuse campaign ids that are not `cmp_…` (or
equal to `ROSTER_MEDIA_ID`) in deleteCampaign/loadCampaign, with a regression test.

## Notes
Found while implementing the roster (Phase 5, 2026-10-20); left unfixed in that step.

## TODOs
- [ ] Guard deleteCampaign (and the media route if needed) against the `roster` id; add a test.

## Completed
