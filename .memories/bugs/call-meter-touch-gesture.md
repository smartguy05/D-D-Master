# Bug: the level meter never resumed on a tap (iOS / Android)
Status: fixed (2026-10-22)
Area: web

## Overview
The talking-ring fix resumed the meter's `AudioContext` on window `pointerdown` / `keydown`. A touch
`pointerdown` is not a user activation (HTML: only a mouse one is), so on iPhone/iPad the resume was
refused and the rings never lit; Android Chrome missed the first tap.

## Repro
Open /play on an iPhone, join the call, tap around and talk: no talking ring.

## Root cause / Fix
Wrong gesture events. apps/web/src/call/levelMeter.ts `onUserGesture(target, fn)` listens to
`pointerup`, `touchend`, `click` and `keydown` in the capture phase (stopPropagation can't hide them);
VideoStrip.tsx uses it. Test: call/levelMeter.test.ts ("onUserGesture").

## Notes
Found in the second Phase C review of PR #1 (follow-up to call-level-meter-suspended-and-leaks.md).

## TODOs

## Completed
- 2026-10-22: Fixed.
