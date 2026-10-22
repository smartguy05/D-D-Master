# Bug: the TV's roll toast listed a secret roll's dice and modifier
Status: fixed (2026-10-22)
Area: web (table/TableScene.tsx RollToast, table/rollToast.ts)

## Overview
Found while splitting `TablePage` into `TableScene` (online play phase 4). A secret roll
(`roll_dice … secret: true`) showed "?" as its total, but the toast's detail line still read
"1d20+2 → [13] +2" (and "NATURAL 20!", success/fail when set), so the room could add it up.
gameplay/dice-modes.md says secret rolls show no dice or total on the TV. On a remote `/play` page
the server's redaction (zeroed dice) would have read "→ [0]".

## Repro
`POST /api/tools/roll_dice {"notation":"1d20+2","label":"Perception","secret":true}` with `/table`
open: the toast under the (absent) dice shows the kept die and the modifier.

## Root cause / Fix
`RollToast` hid only the total and the cover note for a secret roll. The toast text now comes from
the pure `rollToastView` (table/rollToast.ts): a secret roll shows only its notation and "?" (no
dice, modifier, natural, cover or result), so the TV and a remote page (redacted roll) read the
same. Tests: table/rollToast.test.ts.

## Notes
- `DiceTray` already threw no dice for a secret roll and `flourishFor` gave no crit/fumble burst.

## TODOs

## Completed
- 2026-10-22: fixed with tests (phase 4).
