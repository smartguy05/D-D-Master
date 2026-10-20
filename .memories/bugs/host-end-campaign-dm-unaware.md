# Bug: Host-triggered end_campaign was never reported to the live DM
Status: fixed (2026-10-20)
Area: server / realtime

## Overview
Host engine-tool calls reach the DM via `hostActionNote` in `runTool`'s engine branch, but
`end_campaign` is a service tool and `endCampaign` sent no note nor refreshed instructions; the
instructions did not mention `Campaign.status` at all.

## Repro
With the realtime DM connected, the host clicks End campaign (POST /api/tools/end_campaign, source
host). The TV shows the campaign-complete screen; the DM keeps narrating, and a later
`end_campaign` of its own gets an unexplained "already completed" error.

## Root cause / Fix
`endCampaign(args, source)` calls `dm.refreshInstructions()` and, for source `host` with an open
DM, `dm.addSystemNote("Host did: end_campaign (…). The campaign is now completed…")`.
`buildInstructions` adds a `CAMPAIGN COMPLETE` / `CAMPAIGN ENDED` line for a finished campaign.
Tests: service.host-note.test.ts, instructions.test.ts.

## Notes

## TODOs

## Completed
- 2026-10-20: Fixed with regression tests.
