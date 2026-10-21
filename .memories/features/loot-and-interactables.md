# Feature: Loot drops and interactables
Status: done (vertical slice)
Docs: docs/reference/tool-catalog.md, docs/reference/game-state.md, docs/server/images.md, docs/server/tools-engine.md, docs/server/realtime-sideband.md, docs/web/table-display.md, docs/web/host-ui.md, docs/web/player-view.md

## Overview
Phase 3 of the features plan. The DM leaves loot on the map when a foe dies (`drop_loot`, by
`monster_id` before `remove_monster`, or at `x,y`), players take it with `pick_up`, and notable
usable things (levers, chests, altars) are interactables (`place_interactable`, `set_interactable`,
`remove_map_object`), placed by the DM or the host, or read off the map by the vision model
(`MapFeature.interactive`). Every item gets its own cached icon; loot piles show a loot-sack sprite
on the TV, interactables a soft glow with twinkling stars (hidden once used), and a pick-up shows a toast.

## Notes
- Schema: `MapObject {id, locationId, kind: loot|interactable, name, x, y, items, gold, iconUrl?,
  discovered, used, hidden}` in `GameState.mapObjects` (default `[]`); `Item.iconUrl?`;
  `MapFeature.interactive` (default false). Old saves load unchanged.
- Engine: `engine/mapObjects.ts`. Errors throw (state unchanged). `pick_up` merges with
  `addToInventory` (state.ts, shared with `give_item`): case-insensitive stack, an existing stack
  without an icon gains the loot item's icon. No distance check (decision: the DM narrates the
  approach; hunting for cells was a bug before, see bugs/dm-hunts-cells-around-lever.md).
  Omitting `items` takes everything including gold; naming items takes gold only with `gold: true`.
  Empty loot is removed; interactables never are.
- `EngineOutcome.lootDropped` → `GameService.drawLootIcons` (void): loot sack (`images.lootSack`,
  stored on the object's `iconUrl`, cached on disk so one draw per campaign) and item icons
  (`cachedItemIcon` first, else `drawItemIcon`, deduped by campaign + lower-cased name like
  `drawSprite`). Icons are patched into all map-object and inventory items of that name without
  one. Campaign switch mid-draw: not committed.
- `EngineOutcome.pickups` → `pickup` ServerEvent (never persisted).
- DM instructions: "Objects here" block for the current location (hidden/used tags), refreshed
  after a changed map-object tool; persona lines for drop_loot/pick_up/place_interactable/
  set_interactable. The persona avoids the word "altar" (an existing test checks feature-edit
  overrides by its absence).
- Host notes (`hostActionNote`) name the object and its id for place/set/remove.
- Web: visibility is `mapObjectShownOnTable` / `interactiveFeatureShownOnTable` (table/visibility.ts);
  plans in `table/mapObjects.ts` (`lootMarkers`, `auraPlan`, `pickupToastText`), all pure and
  tested. `MapBoard` `LootMesh` (sack billboard or chest mesh, bob, `Sparkles` points — the shared
  `Particles` is a one-shot burst, so it is not used for a looping glint) and `AuraMesh` (soft cell-shaped glow + twinkling star points,
  additive, depthWrite false, renderOrder 1; used interactables are left out by `auraPlan`). Pick-up toast via `useServer`'s 5th listener `onPickup`.
  Host Board tab ✦ Objects mode (`board/objects.ts` labels); feature editor `interactive` checkbox
  (edit_map_feature passes it through).

## TODOs
- [ ] Visual check on the TV: sack size/bob, aura colour over fog, toast placement. (see general/live-test-checklist.md)
- [ ] Live test: kill a goblin, check the DM calls drop_loot before remove_monster, then pick_up. (see general/live-test-checklist.md)

## Completed
- 2026-10-20: shared schemas and tools, engine handlers, images (item icons, loot sack), service
  icon drawing and pickup broadcast, DM instructions and persona, vision `interactive`, host notes,
  docs.
- 2026-10-20: web: TV loot markers (sack billboard, chest fallback, bob, sparkles), interactable
  and interactive-feature auras (dim when used, over fog), pick-up toast with icons, item icons in
  the TV party inventory and the phone inventory, host Board tab Objects mode (list, place,
  hide/show, mark used, remove) and the feature editor's interactive checkbox; docs
  (table-display, host-ui, player-view, data-flow).
- 2026-10-20: review fixes: item icon cache ignores case/spaces (bug item-icon-cache-case-sensitive),
  pick_up refuses an empty take (bug pick-up-takes-nothing), item names trimmed and matched with
  `sameItemName` (bug loot-item-names-untrimmed), `repairLootIcons` after undo and on load (bug
  loot-icons-lost-on-undo).
- 2026-10-20: softer interactable marker: the pulsing ring, disc and rising shimmer were too loud
  (user feedback); now a cell-shaped glow that breathes plus twinkling stars, with no size change.
  Used interactables are hidden on the TV and the phone map (were drawn faint).
