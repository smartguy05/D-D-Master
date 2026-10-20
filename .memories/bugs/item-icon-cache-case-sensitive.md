# Bug: item icon cache treats "Dagger" and "dagger" as different items
Status: fixed (2026-10-20)
Area: server (images/index.ts item icons)

## Overview
`itemIconPrompt(name)` put the raw name into the prompt, and `imageFileName` hashes that prompt, so
`cachedItemIcon(c, "Dagger")` and `cachedItemIcon(c, "dagger")` pointed to different files. Everything
else (drawItemIcon dedupe, drawLootIcons patching, addToInventory, pick_up) matches item names
ignoring case, so only the disk cache disagreed and paid for the same icon twice.

## Repro
drop_loot items [{name:"Dagger"}], let the icon draw; later drop_loot items [{name:"dagger"}] (or
"Dagger "). The second drop missed the cache and made a second images.generate call.

## Root cause / Fix
The cache key was the display prompt. `generate()` now takes an optional `cacheKey` (defaults to the
prompt). Item icons hash `itemIconPrompt(name.trim().toLowerCase())` but still send the name as written
(trimmed) in the prompt. The loot sack's name is already lower case, so its file name is unchanged.
drawLootIcons now also groups and patches names trimmed + lower-cased.
Test: `images/index.test.ts` ("caches by item name ignoring case and surrounding spaces").

## Notes
- The first casing drawn decides the picture's prompt; "dagger" afterwards reuses it.

## TODOs

## Completed
- [x] 2026-10-20 Case- and space-insensitive item icon cache key, with a regression test.
