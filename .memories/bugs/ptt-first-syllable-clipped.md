# Bug: the first syllable after Space on the TV was clipped
Status: fixed (2026-10-22)
Area: web (lib/floor.ts tableMicEnabled, table/useTableVoice.ts, table/TablePage.tsx)

## Overview
Phase B review (PR #1, B8). /table opened its room mic track only when the server's `floor`
broadcast came back, even for the TV's own Space key, so the start of what was said during the
round trip never reached the DM.

## Repro
Push-to-talk on, hold Space on the TV and start talking at once: the transcript misses the first
word or so (worse on a slow network).

## Root cause / Fix
`tableMicEnabled` takes `localPress`: while the TV's own Space is down and not yet granted
(`TalkPress.waiting`) on a free floor, the track is enabled at once. Not while someone else holds the
floor (that press will be refused). `useTableVoice(view, localPress)`. Tests: lib/floor.test.ts
"tableMicEnabled with the TV's own key (localPress)".

## Notes
- Server gate unchanged: `Floor.covered(from, to)` keeps a turn any hold overlaps. A turn begun in
  the pre-open moment is still going when the grant lands, so it overlaps the room's hold and is
  kept; a turn spoken entirely before a press that was never granted overlaps no hold and is dropped.
- Phones keep the round trip (their hold reaches the TV only through the floor broadcast).
- A tap released before the grant arrives closes the mic at once (no local tail); the grant and the
  release broadcast then give the usual tail.

## TODOs
- [ ] Live check on the TV: first word after Space is in the transcript

## Completed
- 2026-10-22: Fixed with tests.
