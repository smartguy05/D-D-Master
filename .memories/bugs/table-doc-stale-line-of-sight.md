# Bug: Table display doc still said line of sight was a plain radius
Status: fixed (2026-10-20)
Area: docs

## Overview
`docs/web/table-display.md` "Light (`TorchLight`)" said "Line of sight is a plain radius: there is
no wall or door data yet", after walls, doors and `los.ts` `visibleCells` had shipped (commit
0444708). A reader would think monsters behind walls show on the TV.

## Repro
Read the Light section of docs/web/table-display.md before 2026-10-20 (Phase 2 moments work).

## Root cause / Fix
The walls change updated the Fog section but missed the Light paragraph. Rewrote it: the 3D torch
point light still shines through walls, but fog reveal uses line of sight, so rooms behind walls
stay fogged.

## Notes
Found while adding the Moments section to the same doc.

## TODOs

## Completed
- 2026-10-20: Light paragraph corrected.
