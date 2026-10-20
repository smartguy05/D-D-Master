# Bug: attitude moment of a hidden monster chimed on the TV
Status: fixed (2026-10-20)
Area: web (table)

## Overview
The new `attitude` moment (adjust_attitude crossing a threshold) passed straight through
`visibility.ts` `momentForTable`, which only filtered death, revived and turn_start. A hidden
ambusher (or a creature in unseen fog) whose attitude changed would play the chime on the TV and
flash a ring, telling the table something is there.

## Repro
Hidden monster on the map; the DM calls `adjust_attitude` on it with a delta that crosses -3 or +3.
Before the fix, the TV played the attitude chime.

## Root cause / Fix
`momentForTable` listed the target-specific kinds to filter by hand and the new kind was not added.
Fix: `attitude` is filtered like death/revived/turn_start (dropped unless `monsterShownOnTable`).
Test: "drops an attitude moment of a hidden monster but keeps it for a shown one" in
`apps/web/src/table/visibility.test.ts`. Found while wiring the attitude ring flash, before it
shipped.

## Notes
- Any new targeted moment kind must be added to `momentForTable` too.

## TODOs

## Completed
- 2026-10-20: attitude added to the filtered kinds, with a test.
