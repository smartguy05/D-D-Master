# Bug: Roster panel not refreshed after end_campaign saved linked PCs
Status: fixed (2026-10-20)
Area: web (host roster panel)

## Overview
`rosterVersion` (HostPage) was only bumped by the host's own roster buttons. `end_campaign` saves
every linked PC back to the roster on the server (`saveLinkedToRoster`) without a roster event, so
an open Roster panel kept showing the old level / updated time / voiceprint flag.

## Repro
Host has PartyTab's "Bring an existing hero" panel open; the DM calls end_campaign after the linked
hero levelled 5 -> 6. The panel still shows Lv 5 until another roster call.

## Root cause / Fix
No refetch trigger for server-side roster saves. Fix: `rosterRefreshKey(campaign)` in
`apps/web/src/host/roster.ts` (`<id>:open` / `<id>:ended`); HostPage bumps `rosterVersion` in an
effect keyed on it, so the panel refetches when the campaign becomes completed or failed. Tests in
`apps/web/src/host/roster.test.ts`.

## Notes
A server-broadcast roster-changed event would also cover other tabs/hosts; not needed for one host.

## TODOs

## Completed
- [x] 2026-10-20: rosterRefreshKey + HostPage effect + tests.
