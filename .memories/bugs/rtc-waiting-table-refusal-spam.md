# Bug: a waiting table screen is re-sent "Another table screen carries the call" on every change
Status: fixed (2026-10-22)
Area: server

## Overview
With two /table screens in the call, `RtcRelay.pickRoom` runs on every table prefs join and every
voice-owner change. Each run sent the refusal again to every waiting table and fanned a full peers
list out to every member, even when the room and its prefs had not changed.

## Repro
Open two /table pages, both join the call. Toggle the camera on either one or start/stop the voice
DM: the waiting table gets another refusal each time, and every member gets a peers list it already had.

## Root cause / Fix
`pickRoom` sent unconditionally. It now announces only when the room or its prefs changed (or the
room left; `leave()` passes `roomLeft`). It remembers the waiting tables it already told
(`toldWaiting`) and tells each one again only after its status changes: the entry clears when the
table becomes the room or leaves. Tests: `apps/server/src/rtcRelay.test.ts` ("tells a waiting table
once…", plus the last table leaving in "one table is the room…").

## Notes
Every refusal now also carries `refusedCode` (`RTC_REFUSED_CODES` in packages/shared/src/rtc.ts),
so clients branch on the code instead of the text.

## TODOs

## Completed
- 2026-10-22: refusal sent once per status change; no fan-out when nothing changed.
