# Bug: map paints fail with 400 "The model 'gpt-image-1' does not exist."
Status: fixed (2026-10-23)
Area: server (images, config)

## Overview
Every map paint failed at once with `400 The model 'gpt-image-1' does not exist.` (code `invalid_value`).
The user thought the API was down. It wasn't: OpenAI retired gpt-image-1 for images.generate,
though `GET /v1/models` still lists it.

## Repro
Any `POST /api/campaign/map` with `IMAGE_MODEL=gpt-image-1`. Diag `job` events in the user's
dm.sqlite at 2026-10-23 16:06–16:11 ("Painting map: Pantry Peaks", ms 332–1014).

## Root cause / Fix
- The default and `.env` model was retired. gpt-image-2, its successor, refuses `background: "transparent"`,
  which sprites and item icons need.
- Fix: `config.imageModel` defaults to `gpt-image-2` (maps), and the new `config.imageTransparentModel`
  (`IMAGE_TRANSPARENT_MODEL`, default `gpt-image-1.5`) handles transparent requests. `ImageService.model(transparent)`
  picks the model, and `asset()` hashes with that same model so `cachedSprite` / `cachedItemIcon` find the files.
- Test: `images/index.test.ts` "paints maps with IMAGE_MODEL and transparent art with IMAGE_TRANSPARENT_MODEL".
- Checked live: gpt-image-2 1536x1024 map ok; gpt-image-1.5 transparent sprite → RGBA PNG.

## Notes
- The asset hash includes the model, so pictures cached under gpt-image-1 aren't reused: item icons
  and sprites without a stored URL are redrawn (and paid for) the next time they're needed.
- See general/api-notes.md (Images).

## TODOs
- [ ] Look at a real sprite and a map from the new models at the table (style change from gpt-image-1) (see general/live-test-checklist.md).

## Completed
- 2026-10-23: split map/transparent models, defaults updated, docs/server/images.md + configuration.md.
