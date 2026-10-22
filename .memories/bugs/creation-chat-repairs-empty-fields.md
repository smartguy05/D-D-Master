# Bug: the creation chat asked for a repair of fields it never set
Status: fixed (2026-10-22)
Area: server (brain/creation-chat.ts)

## Overview
A reply whose patch held `name: ""` (structured output fills every field) got a second "repair"
call, because `name` still had its "missing" error.

## Repro
`service.creation.test.ts` › "a line runs in the background…": the fake brain's second reply was
missing, so the turn failed and only a system note appeared.

## Root cause / Fix
- `patchErrors` counted every key in the patch. But `mergeChoices(…, { fromAi: true })` treats `""`,
  `[]` and `{}` as "no change".
- Fix: `patchErrors` skips empty values (`isEmpty`), the same rule as the merge.
- Also: a repair call that throws now keeps the answer already in hand
  (`.catch(() => undefined)` → `break`) instead of failing the whole turn.
- Tests: `creation-chat.test.ts` › patchErrors (empty values), and the service chat tests.

## Notes
See .memories/bugs/pregens-blind-in-fog.md: the same structured-output quirk.

## TODOs
## Completed
- 2026-10-22: Fixed with tests.
