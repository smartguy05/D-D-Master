# Bug: /table kept its call mic open after the last remote player left
Status: fixed (2026-10-22)
Area: web

## Overview
On /table the call opens a second mic capture once a remote member exists, but never released it when
the last remote left: a second live capture and the browser's mic indicator stayed on.

## Root cause / Fix
useCall.ts only handled `wantMic` turning true. Fix: `micStep(want, open)` (call/callSteps.ts)
returns "release" when the mic is no longer wanted; useCall then `setLocalMic(null)` and the
existing cleanup effect stops the tracks. Test: call/callSteps.test.ts.

## Notes
Found in the Phase C review of PR #1.

## TODOs

## Completed
- 2026-10-22: Fixed.
