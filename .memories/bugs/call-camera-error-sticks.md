# Bug: a missing or denied webcam left a permanent red error and a lying camera toggle
Status: fixed (2026-10-22)
Area: web

## Overview
On /play the camera was on by default. A player with no webcam, or who denied access, got a red
"Camera: ..." note that never went away, and the 📷 toggle still said the camera was on. A mic
error and a camera error also overwrote each other (one `error` string).

## Repro
Open /play on a machine without a webcam (or deny the prompt).

## Root cause / Fix
useCall.ts set one `error` on any failure and never cleared it; `prefs.camera` stayed true.
Fix: `call/mediaErrors.ts` keeps `{mic, camera}` apart. `nextCameraError` clears the camera note on a
new try, a working capture, or the user turning it off (kept when the failure itself turned it off,
so the note explains why). `cameraFailure`: `NotFoundError` / `NotAllowedError` /
`OverconstrainedError` set `prefs.camera` false. `DEFAULT_PLAY_PREFS.camera` is now false. Tests in
call/mediaErrors.test.ts and tiles.test.ts.

## Notes
Found in the Phase C review of PR #1.

## TODOs

## Completed
- 2026-10-22: Fixed.
