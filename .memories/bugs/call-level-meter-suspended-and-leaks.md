# Bug: talking rings never lit on iOS Safari; level-meter nodes leaked
Status: fixed (2026-10-22)
Area: web

## Overview
The call's `LevelMeter` made its `AudioContext` lazily and never resumed it, so on iOS Safari (which
starts it suspended) the talking rings never lit. VideoStrip only fed current peers, so members who
left never got `watch(id, null)` and their source/analyser nodes piled up over a long session.

## Root cause / Fix
apps/web/src/call/levelMeter.ts: resume right after making the context (injectable factory for
tests); `keys()` and `prune(keep)`. VideoStrip.tsx prunes to `call.peers` on every render and
resumes the meter on the sound unlock and on user gestures (see call-meter-touch-gesture.md: `pointerup` / `touchend` / `click` / `keydown`). Tests: call/levelMeter.test.ts.

## Notes
Found in the Phase C review of PR #1.

## TODOs

## Completed
- 2026-10-22: Fixed.
