# Bug: rtc_join was not rate-limited; each one fanned a peers list out to every call member
Status: fixed (2026-10-22)
Area: server

## Overview
`RtcRelay.join` re-announced the member list on every `rtc_join`, even when the prefs had not
changed. A remote player could send thousands of joins (alternating prefs) and the server sent ~6
`peers` events per join, re-rendering the TV and every other page.

## Repro
Review scratch test: 1 table + 5 remote players, one socket sends 10,000 `rtc_join` -> 60,000 sends.

## Root cause / Fix
Only `rtc` signals had a budget. Now `RTC_JOIN_MAX` (20) joins per socket per 10 s, and a join that
changes nothing (same prefs) sends nothing. Test in `rtcRelay.test.ts`.

## Notes
- Every client message that fans out to other sockets needs a per-socket budget (ptt has one too).

## TODOs

## Completed
- 2026-10-22: Throttle and no-op skip, with test.
