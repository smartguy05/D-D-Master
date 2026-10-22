# Bug: phone edits couldn't remove a key from a record field
Status: fixed (2026-10-22, before the UI shipped)
Area: server (game/creation/draft.ts) + web (player/creation/useCreation.ts)

## Overview
`mergeChoices` merges `baseAbilities`, `speciesChoices`, `backgroundBonuses` and `featPicks` per key.
A phone sending the whole new record kept stale keys: a standard-array swap that empties a score, or
a species change that should drop the old lineage. And `clear` ran **after** the merge, so
clear + value wiped the new value too.

## Root cause / Fix
- `mergeChoices` now clears first, then merges, so clear + value replaces a record.
- `useCreation.flush` always sends record fields as `clear: [field]` plus the whole value
  (`RECORD_FIELDS`).
- Test: `draft.test.ts` › "clear runs first, so clear + value replaces a record".

## TODOs
## Completed
- 2026-10-22: Fixed with a test.
