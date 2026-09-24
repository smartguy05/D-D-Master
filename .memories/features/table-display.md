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

## TODOs
- [ ] Fog of war / reveal areas
- [ ] Line of sight and light radius
- [ ] Animated attack effects (slash, fireball burst) triggered by tool calls
- [ ] Player phone view (personal sheet + inventory)
- [ ] Map editing (walls/doors) and drag-to-move tokens from the host

## Completed
- 2026-09-24: Board, tokens, HUD, initiative, inventory, speaker glow, jobs.
