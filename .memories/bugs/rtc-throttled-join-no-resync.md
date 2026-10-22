# Bug: a throttled rtc_join left the page out of sync with the call
Status: fixed (2026-10-22)
Area: server, web

## Overview
An rtc_join over RTC_JOIN_MAX (per socket, per window) was dropped silently. The page had already
flipped its camera/mic/character toggle, but the others still saw the old prefs, and nothing ever
told the page.

## Repro
Toggle a call pref on /play more than 20 times inside 10 s. The last toggles show on that page and
nowhere else.

## Root cause / Fix
`RtcRelay.join` returned on `!allowJoin`. It now calls `resync(ws)`, which sends that socket only
the call as it stands: a member gets `{ self, peers }`, a waiting table gets the `other_table`
refusal again, anyone else gets `{ self: null, peers: [] }`. Membership and prefs don't change, and
nothing goes to other members, so the throttle still caps the fan-out. Test:
`apps/server/src/rtcRelay.test.ts` ("a throttled join resyncs the page…").

Client half (found in the second Phase C review: the page never read the resync, so the bug still
reproduced): `callSteps.ts` `ownPrefsStale(sent, ev)` compares the page's own entry under `self`
with the prefs of its last rtc_join (camera sent as `camera && !!localCam`). `useCall` then re-sends
that join once after `RESYNC_RETRY_MS` (10.5 s, past the server window); a matching `peers` cancels
it. Test: `apps/web/src/call/callSteps.test.ts` ("ownPrefsStale").

## Notes
The page re-sends rather than adopting the server copy: a normal echo of an earlier join can arrive
after a newer toggle, and adopting it would undo the user's latest choice.

## TODOs

## Completed
- 2026-10-22: throttled joins answer with the current peers view.
- 2026-10-22: the page re-sends its join when the resync shows older prefs.
