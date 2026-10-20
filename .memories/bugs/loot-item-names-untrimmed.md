# Bug: padded loot item names cannot be picked up by name
Status: fixed (2026-10-20)
Area: server (engine/mapObjects.ts drop_loot/pick_up, engine/state.ts addToInventory)

## Overview
drop_loot stored item names as given ("Dagger "), while pick_up trimmed only the requested name, so
the stored item never matched and the error listed "Dagger " which reads identical. addToInventory
compared untrimmed names too, so "Dagger " became a separate stack next to "Dagger".

## Repro
drop_loot items [{name:"Dagger "}], then pick_up {items:["Dagger "]} or {items:["dagger"]}.

## Root cause / Fix
Names were never normalised on the stored side. drop_loot now trims item names; a new
`sameItemName(a, b)` in engine/state.ts (trim + lower-case both sides) is used by pick_up and
addToInventory, and addToInventory trims a new stack's name. Old saves with padded names still match.
Test: `engine/map-objects.test.ts` ("trims item names on drop ...").

## Notes

## TODOs

## Completed
- [x] 2026-10-20 Trim on drop, trim-insensitive matching, with a regression test.
