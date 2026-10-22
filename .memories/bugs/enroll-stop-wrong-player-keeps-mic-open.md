# Bug: a voice-enrollment stop for the wrong player left the TV's room mic open indefinitely
Status: fixed (2026-10-22)
Area: server (game/service.ts)

## Overview
Phase B review (PR #1, B6). `GameService.finishEnrollment` cleared `enrollTimer` even when
`SpeakerService.finishEnrollment` refused ("Enrollment was not started for this player."). The
recording (`enrollStart`) stayed set, so `FloorView.enrolling` stayed true, and the only timer that
would re-broadcast the floor at `ENROLL_MAX_MS` was gone: /table kept its room mic open (push-to-talk
on) until something else broadcast the floor.

## Repro
Two /host tabs, or Stop clicked on another player's row: `startEnrollment(sam)`, then
`finishEnrollment(ana)` → `ok: false`; advance past `ENROLL_MAX_MS` → the TV's last floor still says
`enrolling: true`.

## Root cause / Fix
The timer was cleared unconditionally. It is now cleared only when the speaker service no longer
reports `enrolling` after the finish (the recording actually ended). Test: service.floor.test.ts
"a stop for a player who isn't being recorded (a second host tab) leaves the recording and its cap alone".

## Notes
- The floor is still broadcast on a refused finish (harmless: it repeats `enrolling: true`).

## TODOs
- [ ] Live check: two host tabs, stop enrollment from the wrong row; the TV mic closes at the cap

## Completed
- 2026-10-22: Fixed with test.
