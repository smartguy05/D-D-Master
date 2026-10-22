# Bug: with push-to-talk on, enrolling a voice from the table mic recorded silence
Status: fixed (2026-10-22)
Area: web (lib/floor.ts, table/useTableVoice.ts), server (game/service.ts floorView), shared (FloorView)

## Overview
Found in the phase 3 review. Push-to-talk disables the `/table` mic track while nobody holds the
floor, so the `/ws/audio` stream carries silence. `pickAudioSource` falls back to the table stream
when `/host` has no mic stream, so *Record voice* in the Party tab recorded silence and
`finishEnrollment` answered "Didn't hear enough speech" unless someone held Space the whole time.

## Repro
Push-to-talk on, no `/host` mic stream, nobody on the floor: *Record voice* → speak 5 s → *Done*.

## Root cause / Fix
The table's mic gate (`tableMicEnabled`) knew only the floor and mute. The floor view now carries
`enrolling: true` while `SpeakerService.enrolling` (broadcast by `startEnrollment` and
`finishEnrollment`, plus a timer at `ENROLL_MAX_MS` for a forgotten recording), and
`tableMicEnabled` opens the mic while it is set (mute still wins). The enrollment words are not a DM
turn: the session has no separate enrollment guard, but nobody holds the floor, so the push-to-talk
session gate (`DmHost.outsideFloor`) drops the turn. Tests: lib/floor.test.ts ("open while a voice
is being enrolled…"), service.floor.test.ts ("voice enrollment (the table mic stays open while
recording)", including "words said while enrolling are still no DM turn").

## Notes
- With push-to-talk off the table is an open mic, so enrollment words reach the DM as before (no
  change; enroll before starting the DM, or mute isn't an option since enrollment needs the mic).
- Related, same review: `TalkButton` stayed pressed when push-to-talk went off mid-press (now
  `TalkPress.sync`), and `inRoom` came from the access level instead of the socket's origin (now
  `Hub.inRoom`). See features/online-play.md.

## TODOs
- [ ] Live check: enroll from the table mic with push-to-talk on (general/live-test-checklist.md)

## Completed
- 2026-10-22: fixed with tests (phase 3 review).
