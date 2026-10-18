# Bug: Painted map rendered as a plain white board on /table
Status: fixed (2026-10-18)
Area: web (table)

## Overview
After painting a location map, /table showed a flat white grid (no stone, pews, etc.) even though
the PNG loaded fine (200, shown correctly in the /host location card).

## Repro
Seed the demo, paint/repaint the Chapel Nave map, open /table: the revealed board is pure white.

## Root cause / Fix
`Board` in `MapBoard.tsx` rendered `<meshStandardMaterial color=…>` until the texture loaded, then
`<meshStandardMaterial map={tex}>` in the same slot. React reused the material and only patched
props: dropping `color` reset it to white, and setting `map` on an already-compiled material does
not recompile the shader (no `USE_MAP`), so the map was never sampled. Fix: key the material
(`tex.uuid` / `"fallback"`) so the loaded map mounts a fresh material.

## Notes
- Any R3F material that goes from no texture to a texture needs a remount (key) or
  `material.needsUpdate = true`. Swapping one non-null texture for another is fine (tokens).

## TODOs
- (none)

## Completed
- 2026-10-18: Fixed and verified on /table (painted Chapel Nave visible under fog and torch light).
