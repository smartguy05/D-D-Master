# Bug: the public campaign was filtered with the previous campaign's state
Status: fixed (2026-10-22)
Area: server (publicFeed.ts)

## Overview
Found while writing `PublicFeed` (online play phase 2), before it shipped. `loadCampaign` broadcasts
`campaign` and then `state`. The feed projected the new campaign with the **old** campaign's state,
so a player saw the wrong (or no) locations, and if the visited set's key happened to match, the
following `state` didn't re-send the campaign, leaving the phone map blank until the party moved.
With colliding location ids it could also show an unvisited location of the new campaign.

## Repro
`feed.next(campaign A)`, `feed.next(state A)`, `feed.next(campaign B)` → B's public locations were
judged on A's visited set.

## Root cause / Fix
The feed kept `state` across campaigns. `PublicFeed.setCampaign` now forgets the state and the
visited key when the campaign changes (or unloads), so B's first `state` re-sends B's campaign.
`publicCampaign` also keeps no locations when `state.campaignId` differs from the campaign's id.

## Notes
- Tests: apps/server/src/publicFeed.test.ts ("loading another campaign"),
  packages/shared/src/projection.test.ts ("another campaign's state").

## TODOs

## Completed
- 2026-10-22: fixed with tests, before the phase 2 commit.
