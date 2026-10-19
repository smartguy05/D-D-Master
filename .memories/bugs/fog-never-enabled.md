# Bug: Fog of war never showed on the TV
Status: fixed (2026-10-19)
Area: server (engine, realtime persona), shared schema

## Overview
In a live campaign the TV showed no fog at all. Both locations had fog entries with
`enabled: false` and dozens of revealed cells.

## Repro
Run a session with the voice DM. It travels with `change_scene` and calls `reveal_area`, but never
calls `set_fog enable`. The table draws `FogLayer` only for an enabled entry, so nothing shows.

## Root cause / Fix
Fog was off per location until the DM called `set_fog enable`, and the persona only said to do that
"in dark or unexplored places". The model skipped it. `reveal_area` quietly created a disabled entry
(it pre-reveals while fog is off) and returned `fogEnabled: false`, which the DM ignored.

Fix: `Location.fog` (default true) is set when the scene is created (outline prompt, host editor
checkbox). `change_scene` creates an enabled entry on the first visit. An existing entry is left
alone, so `set_fog` overrides persist. The persona now uses `set_fog` only for mid-scene changes.

## Notes
- Saves that already have a disabled entry (e.g. cmp_fc62fc3580) are not changed. Use Host →
  Board → Fog on.
- Don't rely on the realtime model to make a "setup" tool call after another tool. Make the
  engine apply the default instead.

## TODOs
- (none)

## Completed
- 2026-10-19: Location.fog + change_scene first-arrival enable; tests in engine/fog.test.ts;
  demo seed verified on a scratch server (fog visible on /table without set_fog).
