---
title: Map and sprite generation
area: server
topic: images
related_code:
  - apps/server/src/images/**
created: 2026-09-24
last_updated: 2026-10-18
last_audited: 2026-10-18
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version; assets served under /media"
  - "2026-10-18: Map prompts pin a left-to-right layout (entrance left, focal feature right)"
  - "2026-10-18: Maps are read after painting (features) and the current scene restaged"
---

# Map and sprite generation

`apps/server/src/images/index.ts` → `ImageService` uses the OpenAI Images API (`IMAGE_MODEL`,
default `gpt-image-1`, and `IMAGE_QUALITY`).

| Method | Size | Prompt style |
|---|---|---|
| `map(campaignId, description)` | 1536×1024 | Top-down orthographic battle map, hand-painted, **no grid, text or creatures** (the grid is drawn in 3D), plus a fixed **layout**: entrance on the LEFT edge, focal feature on the RIGHT (`buildMapPrompt`) |
| `sprite(campaignId, description)` | 1024×1024, `background: "transparent"` | Full-body miniature token art, centered, no shadow |

- Files are written to `<DATA_DIR>/<campaignId>/assets/{map|sprite}_<sha1(model|size|prompt)>.png`
  and served at `/media/<campaignId>/<file>`. The route only accepts `[\w.-]+.png` names.
- **Caching**: the same prompt gives the same file, so repeat requests are free. Changing a
  character's `appearance` and pressing *Redraw sprite* produces a new hash, and therefore a new image.

## When images are generated

- **Maps**:
  - After an outline is written, for the first location.
  - When `change_scene` moves to a location without a map.
  - Manually through *Paint map* / *Repaint map* (`/api/campaign/map`).
- **Character sprites**: when a character is added, and through *Redraw sprite*.
- **Monster sprites**: after `spawn_monster`, once per monster kind. Every monster of that kind gets
  the same `spriteUrl`.

- **Map reading**: right after a map is painted (or *Repaint map* returns the cached file for an
  unchanged prompt), `GameService.readFeatures` sends the PNG (`ImageService.readAsset`) to the
  brain (`readMapFeatures`, job *Reading map: …*) and stores `location.features`. If that location
  is the current scene and combat is not running, `restageForMap` moves the party to the entrance,
  monsters to the focal feature and redraws the fog. Without a brain, or if reading fails, features
  stay `[]` and placement falls back to left entry / right-side spawns.

All of these run as background `job`s, so play continues while images paint. Tokens show colored
initials until a sprite arrives.

## Notes

- `/media` was chosen so it doesn't collide with Vite's `/assets/*` build output (see
  `.memories/bugs/static-assets-route-collision.md`).
- **Orientation** matches the table: the party is placed at the left edge (`placeCharacters`) and
  monsters spawn toward the right (`spawn_monster`), so `MAP_LAYOUT` tells the painter the entrance
  is on the left and the altar/idol/throne end is on the right. Without it, image models default to
  focal-point-at-top, entrance-at-bottom. Changing the prompt changes the cache hash, so
  **Repaint map** regenerates old maps in the new orientation. The model may still drift; repaint
  if a map comes out rotated.
- The table grid is an overlay, so AI maps don't need to align to it. The prompt asks for no grid
  lines, so the two don't double up.
