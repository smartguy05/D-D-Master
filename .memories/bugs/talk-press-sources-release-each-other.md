# Bug: /play talk button and Space released each other's push-to-talk press
Status: fixed (2026-10-22)
Area: web

## Overview
On /play the talk button and the Space key share one `TalkPress`. Holding the button and tapping
Space sent `ptt down:false` on the Space keyup, so the server freed the floor while the button was
still held (and the reverse: Space held, button click-release ended it).

## Repro
Push-to-talk on, /play: hold the talk button, tap Space. The floor is released; the button shows
"pending" until pointerup.

## Root cause / Fix
`TalkPress` kept one boolean, with no record of which input pressed. It now keeps a set of sources:
`press(source)` sends down only when the set goes from empty to non-empty, `release(source)` sends up
only when it empties, `releaseAll()` for blur/unmount/push-to-talk off. TalkButton uses `"pointer"`,
PlayPage's Space uses `"key"`. Tests: `lib/floor.test.ts` ("two inputs share one press…",
"releaseAll…").

## Notes
- The phone's TalkButton without a shared press behaves as before (only one source).

## TODOs

## Completed
- 2026-10-22: Per-source holds (online play phase 4 review).
