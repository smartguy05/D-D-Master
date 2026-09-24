# Bug: Physical dice results didn't show on the table
Status: fixed (2026-09-24)
Area: server

## Overview
`record_physical_roll` added the roll to state but didn't push it to `outcome.rolls`, so no `roll`
event was sent and the TV showed no toast.

## Root cause / Fix
The handler now receives `out` and pushes the roll. DiceTray skips the animation for `physical`
rolls and shows the toast immediately.

## Completed
- 2026-09-24: Fixed.
