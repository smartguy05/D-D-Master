# Bug: Fog of war layer drew over board effects
Status: fixed (2026-09-24)
Area: web (table)

## Overview
A fireball on a goblin at the edge of the revealed area showed for one frame, then vanished under
the fog shroud. The lightning bolt's core disappeared wherever it passed low over fogged cells.

## Repro
Seed the demo (fog on), `POST /api/tools/play_effect {"kind":"fireball","target_id":"Goblin Warrior 1","radius":2}`
and screenshot /table at ~150 ms and ~400 ms.

## Root cause / Fix
The fog mesh had `renderOrder 2`, so three.js drew it after the (transparent, `renderOrder 0`)
effect meshes; with additive effects and a ~0.93-alpha shroud on top they were nearly invisible.
The bolt core used an opaque material, which renders before every transparent object and so was
always covered where the shroud is taller. Fix: fog uses `renderOrder -1` (first among
transparent objects, no depth write), and the bolt core material is `transparent`. Bolts also arc
upward between source and target.

## Notes
- Anything new that must show over the fog needs a transparent material (opaque meshes lying
  lower than the shroud's ~0.35–1.1 unit height get covered).

## TODOs
- (none)

## Completed
- 2026-09-24: Fixed and verified in screenshots (fireball, lightning over fog).
