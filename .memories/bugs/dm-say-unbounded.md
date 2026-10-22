# Bug: Typed input to the DM had no server-side cap or throttle
Status: fixed (2026-10-22)
Area: server

## Overview
`POST /api/dm/say` (the /play page's text box) capped text at 500 characters only in the browser.
A seat-bound remote cookie could post text up to the 5 MB body limit, as often as it liked: the log
(SQLite + every state broadcast) grew with it, and each call sent a Realtime item plus
`requestResponse`, cutting into the DM's turn and ignoring the push-to-talk floor.

## Repro
`curl -X POST https://<tunnel>/api/dm/say -H 'Cookie: <player cookie>' -d '{"playerId":"<own>","text":"<4 MB>"}'`
in a loop.

## Root cause / Fix
The limit lived in `apps/web/src/play/transcript.ts`. Moved `SAY_MAX`/`sayText` to
`packages/shared/src/say.ts` and applied it in the route (blank: 400). Seat-bound callers (no
`anySeat`) are throttled per cookie `sid` (`SAY_MIN_GAP_MS`, 429) and refused while someone else
holds the push-to-talk floor (409). Tests: `app.auth.test.ts` (trim/cap, throttle, floor),
`packages/shared/src/say.test.ts`.

## Notes
- Host/table callers (anySeat) are not throttled: the host types for seats on purpose.
- The throttle stamps before `sendText`, so failing calls (DM offline) count too.

## TODOs

## Completed
- 2026-10-22: Server cap, throttle and floor check (online play phase 4 review).
