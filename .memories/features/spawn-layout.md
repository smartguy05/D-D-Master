# Feature: Spawn layout
Status: done (vertical slice)
Docs: docs/server/tools-engine.md, docs/reference/tool-catalog.md

## Overview
`spawn_monster` lays groups out with pure `planSpawn` (`apps/server/src/engine/spawn.ts`) instead
of a vertical line under the focal feature. Args: `near` (feature name), `formation`
(cluster | arc | line, default cluster), `fog` (any | revealed | hidden, default any), `hidden`
(spawn already hidden from the TV, for ambushes; same `Monster.hidden` as `set_monster_hidden`).

## Notes
- Lexicographic cell key: hard (free < blocked < occupied) > within 2 of a PC > fog miss >
  formation cost > row, column. Deterministic, no rng, so tests are exact.
- An exact x **and** y turns the PC-distance rule off: the DM picked the spot ("the goblin grabs
  you"). Only one of x/y given mixes with the feature/focal anchor and keeps the rule.
- A feature anchor is its footprint (a rect), so a blocking altar gets monsters hugging it; on a
  walkable feature (rug) the middle comes first. Without `near`, the focal feature is the anchor.
- Facing = party centroid direction from the footprint centre; no party → left (default entrance).
- `nearestFreeCell` now takes the features and skips `blocks` cells (start cell included), falls
  back to a free blocked cell, then the clamped start: never throws on a full board.
- `move_token` onto furniture lands on the nearest free cell (the mover's own cell counts as free)
  and returns `redirected: true, reason` so the DM can narrate it. The host
  (`EngineContext.source = "host"`, set by `GameService.runTool`) may drop tokens on furniture;
  only an occupied cell redirects the host. No `force` arg was needed. No persona line either: the
  reason in the result is enough.
- A point anchor within 2 cells of a PC is walked away from the party centroid first (not for an
  exact x/y or a feature footprint), so formations don't fragment.
- Arc front rank is capped at half the party gap and `gap - 3`; extra monsters form ranks behind;
  cells > 90 degrees off the facing cost +50, so big arcs don't wrap around the party.
- `findFeature`: exact > prefix > whole word > contains ("door" -> "Front door", not "Trapdoor").
- `restageForMap` places the party first, then monsters with `planSpawn` (distance rule, facing).

## TODOs
- [ ] Line of sight / walls: "hidden" fog preference is radius-only today
- [ ] Large (size > 1) tokens: planSpawn treats every monster as 1 cell

## Completed
- 2026-10-18: `planSpawn` (cluster/arc/line, near, fog preference, 3-cell distance rule, full-board
  fallback), `spawn_monster` near/formation/fog/hidden, `nearestFreeCell` skips blocking features
  (move_token, placeCharacters, ensureCharacterTokens, restage), persona line, docs, tests
  (`engine/spawn.test.ts`). See bugs/spawn-vertical-line.md.
- 2026-10-18 (review round 1): capped arc with ranks (bugs/spawn-arc-wraps-party.md), anchor shift
  away from the party, whole-word `near` step, `move_token` redirect reason + host may use blocked
  cells (`EngineContext.source`), `restageForMap` monsters via `planSpawn`, mutation tests for the
  placement paths.
