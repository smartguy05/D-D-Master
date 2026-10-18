# Bug: Monsters spawn in a vertical line, on furniture and next to PCs
Status: fixed (2026-10-18)
Area: server

## Overview
`spawn_monster` with count > 1 stacked tokens with `nearestFreeCell(baseX, baseY + i)`, so groups
formed a vertical line down from the focal feature. Tokens could land on `blocks` features (a
blocking altar's own cells) and right next to the party; `move_token` could also put a token on a
pillar or table.

## Repro
Location with a focal `blocks: true` altar; `spawn_monster {name: "Goblin", count: 4}` → four
goblins in one column starting on the altar's middle cell.

## Root cause / Fix
`nearestFreeCell` only checked token collisions, and the spawn loop offset y per monster. Fix:
`planSpawn` (`engine/spawn.ts`) scores every cell (blocked/occupied, PC distance, fog, formation);
`nearestFreeCell` takes the features and skips blocking cells. `move_token` also ignored that the
moving token's own cell counts as free; it now does.

## Notes
- Tests: `apps/server/src/engine/spawn.test.ts`.

## TODOs

## Completed
- 2026-10-18: fixed with the spawn-layout stream.
