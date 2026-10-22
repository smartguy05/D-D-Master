# Bug: the host's room Talk button stuck on "Waiting for the floor…" after a refused press
Status: fixed (2026-10-22)
Area: web / host

## Overview
`GameService.onPtt` drops a down while someone holds the floor (first press wins) or inside
`PTT_MIN_GAP_MS` (250 ms) of the socket's last ptt; it doesn't queue it. `HostTalkButton` kept
`pressed=true`, so when the holder let go the button showed "Waiting for the floor…" for as long as
it was held, and the DM dropped the host's voice turn (nobody held the floor).
Also: the release wiring (pointerleave, lost capture, visibilitychange, unmount) lived only in the
component and had no tests.

## Repro
Push-to-talk on. Sam holds the floor from his phone; the host presses and holds the room Talk
button (busy). Sam lets go: the floor is free, the button says pending, nothing is granted.
Same with release then re-press within 250 ms.

## Root cause / Fix
`host/hostTalk.ts` `RoomTalk` (replaces `roomTalkPress`): wraps the `TalkPress`, takes each floor
update (`update`), and while held and not yet granted to the room re-sends the down when the floor
is free, at once if `ROOM_TALK_RETRY_MS` (300 ms, above the server throttle) has passed since the
last down, else by timer, and every 300 ms while it stays free and ungranted. Once the room held the
floor since the press (this press or the TV's Space) it never re-sends, so the 30 s cap still ends
a hold. `attach(document)` lets go on the page hiding and on detach (unmount); `roomTalkPointer`
holds the pointer handlers. `HostTalkButton` only wires them up.
Tests: hostTalk.test.ts "RoomTalk" (refused-then-free, throttle re-press, never re-takes after the
cap, attach/detach) and "roomTalkPointer" (each release handler lets go once).

## Notes
- A duplicate down that crosses a slow grant broadcast is harmless: the server ignores a down while
  the floor is held.
- The phone `TalkButton` has the same first-press-wins refusal; not changed here.

## TODOs
- [ ] Decide whether the phone/`/play` TalkButton should retry a refused press the same way.

## Completed
- 2026-10-22: RoomTalk retry, testable release wiring, tests, host-ui.md.
