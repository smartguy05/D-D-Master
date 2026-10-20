# Bug: pick_up with nothing to take succeeds and toasts "X picks up nothing"
Status: fixed (2026-10-20)
Area: server (engine/mapObjects.ts pick_up)

## Overview
pickUp never rejected an empty take. On an interactable with no items and no gold (a lever from
place_interactable), or with `items: []` and gold omitted/false, it still logged "X takes nothing from
...", pushed an empty pickups entry, so runTool committed, broadcast a pickup event (TV toast
"Sylvaine picks up nothing") and refreshed the DM.

## Repro
pick_up {object_id: <lever>, character_id: "pc1"}, or pick_up {object_id: <loot>, character_id, items: []}.

## Root cause / Fix
No guard for take.length === 0 && gold === 0. pickUp now throws "Nothing to take from <name>: it holds
<contents>. Name items, or pass gold: true." before changing anything, so the state, log and toast
stay untouched like any other bad call.
Test: `engine/map-objects.test.ts` ("refuses an empty take ...").

## Notes

## TODOs

## Completed
- [x] 2026-10-20 Empty take is an error, with a regression test.
