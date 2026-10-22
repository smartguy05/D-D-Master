# Bug: replaceStream during commitHandover's unmute left the new call on the old track
Status: fixed (2026-10-22)
Area: web

## Overview
`VoiceLink.commitHandover` cleared `standby` and then awaited `replaceTrack(s.track)` on the standby
senders. A `replaceStream` (mic <-> DM mixer, `useTableVoice`) during that await updated
`this.stream` and the old peer, but not the standby, so the call that became live kept sending the
old track (e.g. the DM did not hear a remote player holding the floor) until the next swap.

## Repro
`voice.test.ts` "a replaceStream during the swap's unmute still reaches the new call": slow
`replaceTrack` on the standby sender, replaceStream mid-commit -> sender kept the mic track.

## Root cause / Fix
After the unmute, commitHandover compares each new sender's track with `this.stream`'s current
audio track and swaps it if they differ.

## Notes
- Any async step between "no longer standby" and "now live" is a window other methods can't see.

## TODOs

## Completed
- 2026-10-22: Catch-up swap after the unmute, with test.
