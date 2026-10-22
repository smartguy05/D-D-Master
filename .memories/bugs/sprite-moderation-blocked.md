# Bug: A PC sprite was refused by OpenAI's safety filter and never drew
Status: fixed (2026-10-21)
Area: server (images, service)

## Overview
Pippa Candlewick (cmp_04ee010393, roster too) has no sprite. Its appearance text: "a white bedsheet ghost
costume with eyeholes and a pointy hood … this is for a d&d game". A white hooded sheet with eye
holes and a point reads as KKK robes to the image safety filter. The error showed only as a
short-lived job chip, and nothing was persisted, so it wasn't in the logs.

## Root cause / Fix
`ImageService.sprite` sent the appearance text verbatim, with no retry or fallback.
`generateMonsterSprites` and the predraws swallowed the error. Fix: `isModerationError` +
`sprite(campaignId, subject, rewrite)`. A refusal retries with the brain's rewording
(`GameService.rewriteSpriteSubject`, `SPRITE_REWRITE_SYSTEM`), then with `plainSubject` (the first
sentence). Every try is cached under the original prompt hash. If all are refused, the error is readable:
"Image blocked by OpenAI's safety filter, even reworded. Change the appearance text: …". Job errors
are now saved as `diag` `job` events with the API code (images/index.test.ts).

## Notes
- Rewording the roster appearance also fixes it right away (e.g. "a round cartoon ghost costume from a
  white sheet").

## TODOs
- (none)

## Completed
- 2026-10-21: retry/fallback + tests; job errors persisted.
