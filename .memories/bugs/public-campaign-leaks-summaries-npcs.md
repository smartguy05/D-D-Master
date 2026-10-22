# Bug: Public campaign leaked session summaries, NPCs and location descriptions to players
Status: fixed (2026-10-22)
Area: shared (projection) / server (public feed)

## Overview
`publicCampaign()` (packages/shared/src/projection.ts), sent to every player-tier socket (`/player`,
`/play`), kept `sessionSummaries`, the `premise`, every outline NPC's name and description (met or
not) and visited locations' LLM-written descriptions. A campaign without an outline was returned
unchanged, summaries included.

## Repro
1. Play a session with a brain configured and end it (summarizeSession runs).
2. Open `/play/:id` or `/player/:id` and read the `campaign` frame in the network tab.
3. `sessionSummaries[].summary` contains "DM NOTES:" listing hidden monsters (or, without a brain,
   the raw session log); `outline.npcs` lists unmet NPCs with descriptions.

## Root cause / Fix
The projection treated these fields as player-safe (the doc's "Not covered" said "don't put secrets
there"), but `brain/content.ts` writes DM notes into summaries and the outline model writes the NPCs
and descriptions. Fix: players get `sessionSummaries: []`, `premise: ""`, `outline.npcs: []` and
visited locations' `description: ""`; the summaries/premise clearing applies before the
no-outline early return. No player page read any of these (checked apps/web/src/{play,player,table,call,lib}).

## Notes
- Tests: projection.test.ts "keeps the name, title and visited locations' maps; drops plot secrets…",
  "a campaign without an outline still loses its summaries and premise"; publicFeed.test.ts
  "campaign frames never carry session summaries, NPCs or location descriptions…".
- Docs: docs/server/state-projection.md (`publicCampaign`, Not covered).

## TODOs
- [ ] If a player page later wants a "story so far" recap, add a player-safe summary field written without DM notes.

## Completed
- 2026-10-22: publicCampaign strips summaries, premise, NPCs and location descriptions, with or without an outline.
