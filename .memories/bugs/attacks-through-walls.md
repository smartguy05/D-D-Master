# Bug: Attacks, sight and movement went straight through walls
Status: fixed (2026-10-20)
Area: shared (los.ts, features.ts, schemas), server (engine/tools.ts, fog.ts, board.ts, spawn.ts, rules/cast.ts, brain/content.ts), web (host Board tab, TV MapBoard)

## Overview
The map had no idea of walls. A creature could attack, see and walk through a painted wall or a
closed door: fog revealed rooms behind walls (and the monsters in them), the DM resolved attacks
with no line of sight, `move_token` crossed walls, and "hidden" spawns could land in plain sight
of a wall's far side or be refused behind a wall the party couldn't see through.

## Repro
Party token at (2,2) in a room with a painted wall along x=4; goblin at (6,2) beyond it. Turn fog
on: the light radius revealed the goblin through the wall and the TV showed it. `roll_dice`
"Longsword attack" from the PC at the goblin hit/missed normally. `move_token` the PC to (6,2)
went through the wall.

## Root cause / Fix
- Root cause: no wall data at all; fog, attacks and movement used radius / distance only.
- Fix (phase 1 of the plan, 2026-10-20):
  - `WallSeg` and `Location.walls` (default []), `GameState.wallEdits` (no mapUrl gate; kept on a
    repaint of the same location), `effectiveWalls`.
  - `packages/shared/src/los.ts`: `blocksSight`/`blocksMove`, `edgeBlocked`, SRD corner-to-corner
    `hasLineOfSight` (corners inset; touching a segment end blocks), `coverBetween`,
    `visibleCells`, `moveBlocked`, `coverNote`.
  - Fog reveals `visibleCells`; lit feature glow stops at walls; monsters behind walls stay unseen.
  - `roll_dice` / `request_player_roll` attacks between two tokens: total cover is refused,
    half / three-quarters adds +2 / +5 AC (stored as `roll.cover`, shown in the log and TV toast).
  - Area spells drop targets out of the origin's sight (`no_line_of_sight`).
  - `move_token` (DM) refuses a straight move through a wall, closed door or window; host is not refused.
  - `planSpawn` "hidden" counts cells behind walls as unseen.
  - The vision read (`readMapFeatures`) returns wall/door/window polylines, snapped by `wallsFromLines`.
  - `set_door` (DM + host) and host-only `edit_walls` (Board tab ▮ Walls mode); TV draws doors.

## Notes
- Decisions: wall edits survive a repaint of the same location (host fixes override newly
  detected walls until reset); creatures/`blocks` features only ever give half cover; host token
  drags may cross walls (same as `blocks` features).
- Tests: `packages/shared/src/los.test.ts`, `features.test.ts`, `apps/server/src/engine/{fog,attack-rules,board,spawn,tools}.test.ts`,
  `engine/rules/cast.test.ts`, `brain/map-features.test.ts`, `realtime/instructions.test.ts`,
  `apps/web/src/host/board/geometry.test.ts`, `apps/web/src/table/{doors,visibility}.test.ts`.
- Six older service tests stub `readFeatures` with a plain array; `paintMap` accepts both shapes via
  `asMapRead`.

## TODOs
- [ ] Update the old `readFeatures` stubs to `{features, walls}` and drop `asMapRead`.
- [ ] Live check of wall detection quality on real painted maps (vision model accuracy). (see general/live-test-checklist.md)
- [ ] Movement is a straight-line check only (no pathfinding around walls).

## Completed
- 2026-10-20: Walls, doors, windows; line of sight for fog, attacks (cover), area spells, movement
  and spawns; vision detection; `set_door` / `edit_walls`; host wall editor; TV doors; cover in
  the roll breakdown.
- 2026-10-20: Adversarial review fixes, each with its own bug memory: `door-over-wall-still-blocks`,
  `dm-door-list-stale`, `narrow-door-sealed`, `move-redirect-across-wall`,
  `dm-door-toggle-pins-walls`, `edit-walls-outside-grid`, `spawn-hidden-cells-in-light`,
  `outline-save-overwrites-walls`, `first-paint-fog-through-walls`.
