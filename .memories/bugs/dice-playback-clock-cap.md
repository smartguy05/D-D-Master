# Bug: Dice result toast delayed on slow displays
Status: fixed (2026-09-24)
Area: web

## Overview
In headless Chromium (software GL, a few FPS), the dice were still rolling 5 s after the roll and
the toast never appeared in time.

## Root cause / Fix
`DiceTray` advanced the playback clock by `min(dt, 0.05)`. At under 20 FPS, playback ran slower than
real time. Now `min(dt, 0.25)`: it still guards against tab-switch jumps but keeps real time on weak
TVs and stick PCs. The simulation's stop condition also now accepts "nearly still for 12 frames",
not just the cannon sleep state, so throws end sooner.

## Completed
- 2026-09-24: Fixed; toast verified in a screenshot (total 43 = 8+7+8+8+6+1+5).
