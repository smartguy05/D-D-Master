# Bug: push-to-talk on by default, but no way to talk for the room without the TV's keyboard
Status: fixed (2026-10-22)
Area: web

## Overview
Push-to-talk is on by default (`PUSH_TO_TALK`). The only senders of `{type:"ptt"}` were Space on
/table and the phone/`/play` TalkButton. A TV with no keyboard (or focus on another window, e.g.
/host on the laptop) and no phones meant nobody could hold the floor, so every voice turn was
silently dropped (`[ptt] dropped voice turn …: nobody held the push-to-talk floor`).

## Repro
1. Default `.env` (push-to-talk on), start the voice DM, no phones joined.
2. Talk at the table without pressing Space on the /table window.
3. The DM never answers.

## Root cause / Fix
No room-press control outside /table's Space key. Added a hold-to-talk **Hold to talk (room)**
button on the host Play tab (`apps/web/src/host/hostTalkButton.tsx`, pure logic in
`host/hostTalk.ts`). It shares `TalkPress` (lib/floor.ts) and sends `ptt` with no `playerId`; the
server already took that from a /host socket as a room press that only the same socket can release
(verified by a new test in `service.floor.test.ts`, no server change). Releases on pointerup /
cancel / leave / lost capture, page hidden, unmount, and push-to-talk turning off mid-press.
Docs: running-a-session upgrade note (`PUSH_TO_TALK=0` restores open mic).

## Notes
- A /host socket through the tunnel (host cookie) also presses for the room; that is intended (the
  host is running the table).
- If the TV's Space already holds the room, the host press is refused server-side (first press wins)
  but the button still shows live (the room mic is open either way); its release is ignored.

## TODOs
- [ ] Live check: hold the host Talk button with no phones and confirm the DM answers (not yet in general/live-test-checklist.md: add it there).

## Completed
- 2026-10-22: Refused press retried when the floor comes free, release wiring made testable (bugs/host-talk-refused-press-stuck-pending.md).
- 2026-10-22: Host Talk button, hostTalk tests, server room-press-from-host test, docs.
