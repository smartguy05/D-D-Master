# Feature: Table (TV) display
Status: done (vertical slice)
Docs: docs/web/table-display.md

## Overview
`/table`: a 3D map board (AI map texture + grid) with billboard sprite tokens, a party sidebar
(HP, AC, conditions, inventory, gold), foes list, initiative strip, DM status orb, speaker
highlight, physical-roll banner, dice overlay and toast.

## Notes
- FitCamera computes the distance from the fov and aspect ratio. The earlier heuristic cut off the
  left columns.
- Billboards face the camera fully. With `lockX/lockZ` they looked squashed from the steep camera.
- Fog renders first among transparent objects (renderOrder -1); see bugs/fog-hides-effects.md.
- Headless screenshots (swiftshader) run at a few FPS; effect animations use `min(dt, 0.1)` so they
  play slower there, and a screenshot takes a few hundred ms. Take shots ~150-400 ms after the call.
- Effects are transient `effect` events, not state; a table that connects later does not replay them.

## TODOs
- [ ] Real line of sight: needs wall/door data (map editing) and a shadowcast over the grid
- [ ] Optional darkness vignette outside torchlight in dim locations (lights dim to 60% today)
- [ ] Host UI buttons for fog (enable/reset/reveal by clicking cells); today via DM or /api/tools
- [ ] Sound for board effects (whoosh, crackle) reusing the dice noise synth
- [ ] Player phone view (personal sheet + inventory)
- [ ] Map editing (walls/doors) and drag-to-move tokens from the host

## Completed
- 2026-09-24: Fog of war (per-location revealed cells, reveal_area/set_fog, auto-reveal around
  characters by light radius, 3D displaced smoke shroud with smooth fade, monsters in fog hidden from
  map, foes list and initiative strip).
- 2026-09-24: Light radius (Character.lightRadius, default 6) with flickering torch point lights
  when fog is on. Line of sight is radius-only (no walls yet).
- 2026-09-24: Board effects (effect event + play_effect tool; hit/crit/miss/heal automatic):
  slash arcs, fireball sphere + light, lightning tube bolts, frost shards, poison cloud, radiant
  pillar, necrotic swirl, thunder rings, arcane burst, heal sparkles; token shake + color flash.
- 2026-09-24: Board, tokens, HUD, initiative, inventory, speaker glow, jobs.
