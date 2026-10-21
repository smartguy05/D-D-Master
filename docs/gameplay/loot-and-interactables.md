---
title: Loot drops and interactables
area: gameplay
topic: loot
related_code:
  - apps/server/src/engine/mapObjects.ts
  - apps/web/src/table/mapObjects.ts
  - apps/web/src/host/board/objects.ts
created: 2026-10-21
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Initial version, gathered from tool-catalog, images, table-display, host-ui and .memories/features/loot-and-interactables.md"
---

# Loot drops and interactables

When a foe dies, the DM leaves its loot on the map, and players take it with `pick_up`. Notable
usable things such as levers, chests and altars are **interactables**. The DM or the host can place
them, or the vision model reads them off the painted map as `MapFeature.interactive`. Every item
gets its own cached icon. The TV shows a loot-sack sprite for a pile and a soft glow with
twinkling stars for an interactable (hidden once it is used). A pick-up shows a toast.

## State

`GameState.mapObjects` (default `[]`) holds `MapObject` entries with these fields:
- `id`, `locationId`, `kind` (`loot` or `interactable`), `name`, `x`, `y`
- `items`, `gold`, `iconUrl?`
- `discovered`, `used`, `hidden`

`Item.iconUrl?` and `MapFeature.interactive` (default false) are the only other schema additions,
so old saves load unchanged. See [game state](../reference/game-state.md).

## Tools (`engine/mapObjects.ts`)

| Tool | What it does |
|---|---|
| `drop_loot {monster_id? \| x,y, items, gold, name?}` | Leaves a pile on the monster's cell (call it **before** `remove_monster`) or on a cell. `x`/`y` win if both are given. Gold is whole gp. |
| `pick_up {object_id, character_id, items?, gold?}` | Leaving out `items` takes everything, gold included. Naming items takes the gold only with `gold: true`. An empty take is refused. Empty loot is removed; interactables never are. |
| `place_interactable {name, x, y, hidden?}` | Adds a lever, chest, etc. `hidden` keeps it off the TV until it is revealed. |
| `set_interactable {id, used?, hidden?, name?}` | Mark it used (its glow goes), hide or reveal it, rename it. |
| `remove_map_object {id}` | Removes a pile or an interactable. |

- Handlers mutate the cloned state and **throw** on a bad call, so the caller's state never changes.
  The error text names what is there, for example `No map object "x". Here: …`.
- `pick_up` merges items through `addToInventory` (`engine/state.ts`, shared with `give_item`).
  Stacks match case-insensitively on trimmed names (`sameItemName`). An existing stack without an
  icon gains the loot item's icon.
- There is **no distance check**. The DM narrates the approach. Making the DM hunt for an adjacent
  cell caused a move loop before (bugs/dm-hunts-cells-around-lever).
- Full arguments are in the [tool catalog](../reference/tool-catalog.md).

## Icons (`GameService.drawLootIcons`)

`EngineOutcome.lootDropped` starts a background draw:
- **Loot sack.** `images.lootSack` draws it once per campaign. It is cached on disk and stored on
  the object's `iconUrl`.
- **Item icons.** `cachedItemIcon` is tried first, then `drawItemIcon`. Draws are deduped by
  campaign plus the lower-cased, trimmed name (bugs/item-icon-cache-case-sensitive). The icon is
  patched into every map-object and inventory item of that name that has none.
- **Campaign switch.** If the host switches campaigns during a draw, the result is not committed
  (see [design rules](../architecture/design-rules.md) §4).
- **Repair.** Undo restores only `GameState`, so `repairLootIcons` runs after undo and on load
  (bugs/loot-icons-lost-on-undo).

Image details are in [images](../server/images.md).

## The DM's side

- An **Objects here** block in the instructions lists the current location's objects, with hidden
  and used tags. It is refreshed after any tool that changes a map object.
- The persona has lines for `drop_loot`, `pick_up`, `place_interactable` and `set_interactable`. It
  avoids the word "altar", because an instructions test checks that feature-edit overrides are absent
  by looking for that word.
- Host notes (`hostActionNote`) name the object and its id for place, set and remove.

## Screens

- **TV** (`apps/web/src/table/mapObjects.ts`, pure and tested):
  - `lootMarkers` places loot as `LootMesh` in `MapBoard.tsx`: a sack billboard (or a chest
    mesh) that bobs, with looping `Sparkles`.
  - `auraPlan` places interactables and interactive features as `AuraMesh`: a soft cell-shaped
    glow with twinkling stars, drawn additive with `depthWrite` false and `renderOrder` 1, so it
    shows over fog. Used interactables are left out.
  - Visibility comes from `mapObjectShownOnTable` and `interactiveFeatureShownOnTable`
    (`visibility.ts`).
  - The `pickup` event (never persisted) shows a toast with the item icons (`pickupToastText`).
  - See [table display](../web/table-display.md).
- **Host** Board tab ✦ Objects mode (`host/board/objects.ts`): list, place, hide or show, mark
  used, remove. The feature editor has an `interactive` checkbox. See [host UI](../web/host-ui.md).
- **Phone**: item icons in the inventory. Used interactables are hidden on the phone map too.
  See [player view](../web/player-view.md).

## Known limits

- Not checked live yet: the sack size and bob, the aura colour over fog, where the toast sits, and
  whether the DM calls `drop_loot` before `remove_monster` on its own.
