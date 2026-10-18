# Bug: Repaint map kept the host's Board edits (and showed the same picture)
Status: fixed (2026-10-18)
Area: server (game/service.ts generateMap, images)

## Overview
Host feature fixes are keyed to the map URL so a repaint resets them. But *Repaint map* with an
unchanged prompt returned the cached PNG (file name = sha1(model|size|prompt)), so the URL stayed
the same: the repaint changed nothing visible and the host's feature edits kept applying. A
repaint whose map read found no features also kept the host-hidden fog cells (they were only
cleared inside `restageForMap`, which only runs when features were found).

## Repro
`generateMap(loc)` → `edit_map_feature delete` → `generateMap(loc, true)` with the same prompt:
`effectiveFeatures` still returned the edited list. With a read returning `[]`, `fog.hidden` survived.
(Found by the stream B adversarial review.)

## Root cause / Fix
- `ImageService.map(…, fresh)`: a forced repaint adds a nonce to the hash (`imageFileName`), so it
  skips the cache and gets a new picture and URL.
- `generateMap`: when the URL changes or `force` is set, `resetForRepaint` drops
  `featureEdits[loc]` and that location's explored + hidden fog (and re-lights the party), then
  `restageForMap` runs if features were found; one undoable commit `map repainted: <name>`.

## Notes
- Tests: `apps/server/src/game/service.board.test.ts` ("repaint resets host board edits"),
  `apps/server/src/engine/board.test.ts` (`resetForRepaint`), `apps/server/src/images/index.test.ts`.

## TODOs
- [ ] Old cached map PNGs from forced repaints are never deleted (disk only; small).

## Completed
- 2026-10-18: Fixed with a fresh-image nonce and `resetForRepaint`.
