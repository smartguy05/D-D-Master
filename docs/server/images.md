---
title: Map and sprite generation
area: server
topic: images
related_code:
  - apps/server/src/images/**
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version; assets served under /media"
---

# Map and sprite generation

`apps/server/src/images/index.ts` → `ImageService` uses the OpenAI Images API (`IMAGE_MODEL`,
default `gpt-image-1`, and `IMAGE_QUALITY`).

| Method | Size | Prompt style |
|---|---|---|
| `map(campaignId, description)` | 1536×1024 | Top-down orthographic battle map, hand-painted, **no grid, text or creatures** (the grid is drawn in 3D) |
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

All of these run as background `job`s, so play continues while images paint. Tokens show colored
initials until a sprite arrives.

## Notes

- `/media` was chosen so it doesn't collide with Vite's `/assets/*` build output (see
  `.memories/bugs/static-assets-route-collision.md`).
- The table grid is an overlay, so AI maps don't need to align to it. The prompt asks for no grid
  lines, so the two don't double up.
