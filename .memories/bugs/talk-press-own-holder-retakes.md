# Bug: a press made while its own holder had the floor re-took it after the 30 s cap
Status: fixed (2026-10-22)
Area: web (lib/floor.ts)

## Overview
Found reviewing the phase B fixes. `TalkPress.press()` always set `granted = false` and only
`update()` (a floor change) could grant it. With the room already holding the floor from /host, a
Space press on the TV stayed "waiting"; when the cap released the room, `update(holder:null)` sent
the down again and the room got a new 30 s hold nobody had asked for, while the TV mic stayed open.
This broke the "never re-takes after the cap" rule; the TV should show "Time's up".

## Repro
`update(room held) -> press() -> 20 s -> update(holder null)`: a second down goes out and
`expiredFor(idle)` is false.

## Root cause / Fix
`press()` sets `granted = this.isMine(this.floor)` when the first input starts. Test: floor.test.ts
"a press made while its own holder already has the floor counts as given: it never re-takes it after
the cap".

## Notes

## TODOs

## Completed
- 2026-10-22: fixed with tests.
