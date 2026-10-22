# Bug: the phone's Hold-to-talk button went dead after push-to-talk was toggled mid-press
Status: fixed (2026-10-22)
Area: web (player/TalkButton.tsx, lib/floor.ts)

## Overview
Found in the phase 3 review. Turning push-to-talk off while a player held the button made the
component return null; no pointerup ever came, so its `down` ref stayed true and, once push-to-talk
was back on, every press was ignored as a repeat.

## Repro
Phone holds the button; host turns push-to-talk off, then on; the phone's button does nothing.

## Root cause / Fix
The press state lived in a ref that only pointer events reset. It moved into a pure `TalkPress`
(lib/floor.ts: one down per press, one up per release, `sync(pushToTalk)` lets go when it goes
off); `TalkButton` calls `sync` in an effect on `floor.pushToTalk`. Tests: lib/floor.test.ts
("TalkPress (the phone's hold button)").

## Notes
- One `TalkPress` per seat (`useMemo` on `playerId`), so a seat change lets go for the old seat.

## TODOs

## Completed
- 2026-10-22: fixed with tests (phase 3 review).
