---
title: Map and sprite generation
area: server
topic: images
related_code:
  - apps/server/src/images/**
  - apps/server/src/game/service.sprites.test.ts
created: 2026-09-24
last_updated: 2026-10-19
last_audited: 2026-10-19
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-18: Monster sprites pre-drawn from the outline; missing sprites redrawn on load; shared in-flight draws"
  - "2026-09-24: Initial version; assets served under /media"
  - "2026-10-18: Map prompts pin a left-to-right layout (entrance left, focal feature right)"
  - "2026-10-18: Maps are read after painting (features) and the current scene restaged"
  - "2026-10-18: Forced repaint skips the cache (new URL) and resets host board edits"
  - "2026-10-18: First paint keeps fog; campaign switch during painting is safe"
  - "2026-10-18: Repaint landing while its campaign is not loaded cleans the saved state"
  - "2026-10-18: NPC portraits (add_npc): own sprite key and subject"
  - "2026-10-19: Outline NPC portraits pre-drawn before the encounter monsters"
---

# Map and sprite generation

`apps/server/src/images/index.ts` → `ImageService` uses the OpenAI Images API (`IMAGE_MODEL`,
default `gpt-image-1`, and `IMAGE_QUALITY`).

| Method | Size | Prompt style |
|---|---|---|
| `map(campaignId, description, fresh?)` | 1536×1024 | Top-down orthographic battle map, hand-painted, **no grid, text or creatures** (the grid is drawn in 3D), plus a fixed **layout**: entrance on the LEFT edge, focal feature on the RIGHT (`buildMapPrompt`) |
| `sprite(campaignId, description)` | 1024×1024, `background: "transparent"` | Full-body miniature token art, centered, no shadow |

- Files are written to `<DATA_DIR>/<campaignId>/assets/{map|sprite}_<sha1(model|size|prompt[|nonce])>.png`
  (`imageFileName`)
  and served at `/media/<campaignId>/<file>`. The route only accepts `[\w.-]+.png` names.
- **Caching**: the same prompt gives the same file, so repeat requests are free. Changing a
  character's `appearance` and pressing *Redraw sprite* produces a new hash, and therefore a new image.
  A **forced repaint** (*Repaint map*, `generateMap(id, true)`) passes `fresh`: a nonce joins the
  hash, so the cache is skipped and the map gets a new picture and a new URL.

## When images are generated

- **Maps**:
  - After an outline is written, for the first location.
  - When `change_scene` moves to a location without a map.
  - Manually through *Paint map* / *Repaint map* (`/api/campaign/map`).
- **Character sprites**: when a character is added, and through *Redraw sprite*. Loading a campaign
  redraws any PC sprite that is missing (an earlier draw failed).
- **Monster sprites, ahead of play**: `GameService.predrawSprites` runs after an outline is written or
  edited and when a campaign loads. It draws every `outline.npcs` portrait first (an NPC often
  greets the party before any fight), then every monster kind in `outline.encounters` (catalog
  name, else title case), one at a time, skipping subjects already on disk (`ImageService.cachedSprite`).
  It also redraws missing sprites of monsters already in the state.
- **Monster sprites, on spawn**: after `spawn_monster`, once per monster kind. The subject text is
  `monsterSpriteSubject(base)`, the same as the pre-draw, so a pre-drawn kind is a cache hit with no
  API call. Every monster of that kind gets the same `spriteUrl`.
- **NPC portraits** (`add_npc`, `npc: true`): keyed by the NPC's name, not its stat block. The
  subject is `npcSpriteSubject`: `<name>, a D&D character. <appearance>`, so Captain Mara Venn on a
  Guard stat block never shares the guards' sprite. Without an `appearance` arg, add_npc takes the
  outline NPC's description, the same subject the pre-draw used, so it is a cache hit. A new
  appearance clears `spriteUrl` and draws again.
- `drawSprite` shares one in-flight draw per campaign + subject, so a spawn during a pre-draw waits
  for it. A draw that finishes after the host loaded another campaign is not committed to it.

- **Map reading**: right after a map is painted, `GameService.readFeatures` sends the PNG (`ImageService.readAsset`) to the
  brain (`readMapFeatures`, job *Reading map: …*) and stores `location.features`. If that location
  is the current scene and combat is not running, `restageForMap` moves the party to the entrance,
  monsters to the focal feature. On a **repaint** (forced, or the URL replaced an earlier one)
  `resetForRepaint` first drops the host's Board edits for that location (`featureEdits[loc]`,
  explored and hidden fog) and the restage redraws the fog; one undoable commit labelled
  `map repainted: <name>`. A **first paint** (no earlier map) keeps the fog revealed or hidden on
  the blank grid and only restages tokens (`map painted: <name>`). If the host loaded another
  campaign while the map painted, the result is saved to the first campaign in the database only;
  the loaded campaign's state is never touched. A **repaint** landing then also cleans the first
  campaign's saved state (`stateAfterPaint`: reset + restage, `store.saveState`, no history entry). Without a brain, or if reading fails, features
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
