# Bug: a push-to-talk press the server refused looked held on the client
Status: fixed (2026-10-22)
Area: server (game/service.ts onPtt), web (lib/floor.ts TalkPress, TalkButton, PlayPage, TablePage, host/hostTalk.ts)

## Overview
Phase B review (PR #1, B7). The server drops a `ptt` down inside its per-socket throttle
(`PTT_MIN_GAP_MS`, 250 ms) and while someone else holds the floor (first press wins); it never
queues it. The phone, /play and the TV's Space kept showing a held press ("Waiting…" or nothing)
while the DM heard nothing. Worse, the throttle counted a socket's last *release* too, so letting go
and pressing again quickly (a natural "oops, one more thing") was silently dropped.

## Repro
- TV: hold Space, let go, press again within 250 ms → no floor.
- Phone: press while another player holds the floor, keep holding after they let go → never granted.

## Root cause / Fix
- Server: `lastPtt` is recorded on presses only; a release doesn't start the gap (press-after-press
  is still throttled). Tests: service.floor.test.ts "a press right after that socket's own release
  counts", "a press within PTT_MIN_GAP_MS of that socket's last press is ignored".
- Clients: the retry Phase A added to `RoomTalk` moved into `lib/floor.ts` `TalkPress` (options
  `mine`, `onChange`; `update(floor)`, `waiting`, `expiredFor`). A press with `mine` that hasn't
  been given the floor re-sends its down when the floor is free and then every `TALK_RETRY_MS`
  (300 ms); once granted it never re-takes it (the 30 s cap stands). Used by `RoomTalk` (host),
  `seatTalkPress` (phone, /play button and Space) and the TV's Space (`roomIsMine`). Tests:
  lib/floor.test.ts "TalkPress retry …", hostTalk.test.ts.

## Notes
- /play feeds the shared press every floor itself (`press.update`), so Space retries even without
  the button mounted; TalkButton feeds it too (idempotent).

## TODOs
- [ ] Live check: phone press while someone else holds, keep holding → granted when they let go

## Completed
- 2026-10-22: Server throttle fixed; retry generalised to every press, with tests.
