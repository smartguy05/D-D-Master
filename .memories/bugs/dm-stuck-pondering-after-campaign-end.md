# Bug: after end_campaign the DM orb stays on "The DM ponders…"
Status: fixed (2026-10-21)
Area: server (realtime/session.ts, game/service.ts)

## Overview
After the campaign was completed, the TV's DM orb kept saying "The DM ponders…" (status
`thinking`) and never went back to listening. The host "Stop talking" button didn't help.

## Repro
Voice mode: the DM calls `end_campaign`. The follow-up response to the tool output comes back with
no speech (the story is over), and the status stays `thinking`.

## Root cause / Fix
- In voice mode, `thinking` (set on `response.created`) was cleared only by
  `output_audio_buffer.stopped/cleared`. A response with no audio never cleared it. Text mode reset
  on `response.done`, voice mode didn't.
- `nudgeEmptyFollowUp` then asked "Finish resolving the last action…", which made no sense after
  the ending. The reply was silent again, so the orb stayed stuck.
- `stopTalking` returned early when nothing was in flight, so it couldn't reset the orb.
- Fix:
  - `onResponseDone` sets `listening` in voice mode when the reply had no speech and no audio is
    playing. This happens before the non-completed early return, so cancelled and failed replies
    are covered too.
  - `DmHost.campaignOver()` (wired in GameService as status !== "active") skips the empty-follow-up nudge.
  - An idle `stopTalking` resets the status to `listening`.

## Notes
- The bug affected any silent voice reply. The campaign ending just made it very likely.

## TODOs
- [ ] Live-test an ending in voice mode

## Completed
- 2026-10-21: Fix + session.test.ts "DmSession status after a silent reply (voice)".
