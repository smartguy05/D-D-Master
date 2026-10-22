# Bug: player maps never drew doors or features seen after arriving at a location
Status: fixed (2026-10-22)
Area: server (publicFeed.ts)

## Overview
Found reviewing the phase B fixes (regression from B1, player-map-layout-leak.md). `publicCampaign`
now filters a location's walls and features by revealed fog, but `PublicFeed` re-sent the public
campaign only when the set of visited locations changed. Doors, exits and interactive auras in cells
explored later never reached /player or /play (they read `effectiveWalls`/`effectiveFeatures`, which
fall back to the campaign's) until the party moved or the page reconnected. Cells the host hid again
kept their walls and features on the player side.

## Repro
Campaign location with a door at x=10 and fog revealing 0,0. Reveal 9,0: `feed.next(state)` returns
only `state`, no `campaign`.

## Root cause / Fix
`PublicFeed` keys on `shownKey(publicCampaign(campaign, state))` (visited location ids plus their
projected walls and features) instead of the visited ids, and re-sends the campaign when it changes.
The key for the last sent/observed state is worked out lazily, so `observe` (no player sockets)
stays cheap. Test: publicFeed.test.ts "re-sends the campaign when exploring shows a door or feature
of a visited location, or hides one again".

## Notes
- Reveals that bring no new wall or feature into sight don't re-send the campaign.

## TODOs

## Completed
- 2026-10-22: fixed with tests.
