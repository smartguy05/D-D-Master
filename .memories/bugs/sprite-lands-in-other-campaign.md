# Bug: a sprite draw could land in another campaign
Status: fixed (2026-10-18)
Area: server (GameService sprites)

## Overview
`generateCharacterSprite` and `generateMonsterSprites` committed the new `spriteUrl` with
`this.mutate` after the image API returned, whatever campaign was loaded by then. If the host loaded
another campaign while a sprite was drawing, a PC or monster with a matching id/kind in the new
campaign got the old campaign's `/media/<oldId>/...` url, and the old campaign never got its sprite.

## Repro
Add a character (sprite starts drawing), then load or create another campaign with a same-named
monster/PC before the draw finishes.

## Root cause / Fix
No campaign check after the await. Both now return early when `this.campaign?.id` changed. The
missing sprite is redrawn the next time the original campaign loads (`predrawSprites`). Test:
`service.sprites.test.ts` ("a draw that finishes after the host switched campaigns…").

## Notes
Found while adding sprite pre-drawing.

## TODOs

## Completed
- 2026-10-18: Guarded both sprite commits; redraw-on-load added.
