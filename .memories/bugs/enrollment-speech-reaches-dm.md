# Bug: words said while enrolling a voice reached the voice DM (push-to-talk off)
Status: fixed (2026-10-22)
Area: server (realtime/session.ts, speaker/service.ts)

## Overview
Found while planning the voice ID test. With push-to-talk off, a live voice DM heard "Hi, I'm Sam,
and I'm playing…" during enrollment as an ordinary turn and could answer it. Only the push-to-talk
session gate (`outsideFloor`, nobody holds the floor) dropped those words; there was no
enrollment guard in the session (docs said "the table is an open mic anyway").

## Repro
Push-to-talk off, voice DM live, Party tab → Record voice → say the enrollment phrase → Done. The
DM gets a turn (speaker note + reply) for the phrase.

## Root cause / Fix
No session check for recordings. `SpeakerService.inRecording(from, to)` is now true for a span
that overlaps the running recording (enrollment or voice ID test) or the last finished one (so a
turn committed just after Done still counts). `GameService` passes it as
`DmHost.inVoiceRecording`, and `DmSession.onCommitted` drops the turn like a push-to-talk drop
(`[voice-id]` log line). Tests: session.test.ts "drops a voice turn said while a voice was being
recorded", service.voice-test.test.ts "the DM drops a turn said during the test or an enrollment".

## Notes
- The Realtime model still hears the audio (it is in the call); dropping the committed item is what
  keeps it out of the conversation, the same mechanism as mute/echo/ptt drops.

## TODOs
- [ ] Live check together with the voice ID test (see general/live-test-checklist.md)

## Completed
- 2026-10-22: Fixed with tests.
