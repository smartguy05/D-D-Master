# Bug: undoing a quick pick_up leaves the loot pile without icons for good
Status: fixed (2026-10-20)
Area: server (game/service.ts drawLootIcons, undo, loadCampaign)

## Overview
drawLootIcons ran only after drop_loot and patched icons through an unlabelled mutate(), so no history
snapshot held them. A pick_up made before the (slow) draws finished snapshotted the icon-less state;
undoing it restored a loot pile with no marker and no item icons, and nothing ever drew them again.
A server restart mid-draw had the same effect.

## Repro
drop_loot {monster_id, items:[{name:"Rusty key"}], gold:5}; pick_up right away; wait for the draws;
host Undo. The pile comes back with the chest fallback on the TV and an icon-less "Rusty key".

## Root cause / Fix
No repair path (unlike predrawSprites for sprites). New `GameService.repairLootIcons()` runs
drawLootIcons for every loot object missing its marker or an item icon. It is called after
restoreEntry (undo / rewind) and in loadCampaign. Cached pictures are reused, so it costs no API call
for icons already drawn.
Tests: `game/service.loot.test.ts` ("loot icons after undo or reload").

## Notes
- Interactables are skipped: they never get a loot-sack marker.

## TODOs

## Completed
- [x] 2026-10-20 repairLootIcons after undo and on load, with regression tests.
