# Bug: a finished campaign's session runs on until someone closes it
Status: fixed (2026-10-22)
Area: web (host/HostPage.tsx, host/sessionPrompt.ts)

## Overview
After the campaign ended (end_campaign success/failure, or the death rule), nothing prompted the
host to end the session. The DM kept running (and billing) and no recap was written unless the
host remembered *End session & write recap* on the Adventure tab.

## Repro
Play to the end of a campaign (or End campaign on the Play tab). The TV shows the campaign-end
screen; the DM stays connected indefinitely.

## Root cause / Fix
- No prompt existed. Added `endSessionPrompt(campaign, dmLive)` (pure, tested) and a banner in
  HostPage, above every tab: *End session & write recap* / *Not yet* (dismissed per campaign id).
- Shows while the DM is live on an ended campaign, or while no recap has `ts >= completedAt`.

## Notes
- The banner clears itself: end-session stops the DM and pushes a recap (campaign event).

## TODOs
- [ ] Live-check the banner after a real voice ending

## Completed
- 2026-10-22: Fix + host/sessionPrompt.test.ts.
