# Bug: a secret roll's label and modifier reached players and the TV
Status: fixed (2026-10-22)
Area: shared (projection.ts), web (table/rollToast.ts, table/TableScene.tsx)

## Overview
Found in the online-play review (PR #1, phase B). `redactSecret` zeroed a secret roll's numbers
but kept `label` ("Insight: is the mayor lying") and `notation` ("1d20+7", the modifier names the
skill). The log line from `makeRoll` ("Thorin rolled Insight: is the mayor lying: (secret)") passed
`publicLogEntry`. The TV toast printed `roll.label` in its heading too, on a screen the whole room sees.

## Repro
`roll_dice {"notation":"1d20+7","label":"Insight: is the mayor lying","secret":true}` with a
player phone and `/table` open: the phone's state frame has the label in `rolls` and `log`; the TV
toast reads "DM · Insight: is the mayor lying".

## Root cause / Fix
- projection.ts: `redactSecret` sets `label: ""` and `notation: bareDiceNotation(dice)` ("1d20",
  "2d6+1d4"; grouped by sides in order). `publicLogEntry` rewrites a line ending ": (secret)" to
  "<roller> rolled in secret" (speaker prefix first, regex fallback). Log entries carry no roll id,
  so the match is on makeRoll's text shape.
- rollToast.ts: new `who` field ("Mara · Stealth"; secret: "Mara · secret roll") and a secret
  detail of the bare dice; TableScene's RollToast renders `v.who`.
Host data is unchanged. Tests: projection.test.ts, publicFeed.test.ts, rollToast.test.ts.

## Notes
- If makeRoll's secret line format changes, update `SECRET_LINE` / `secretRollLine` in projection.ts.

## TODOs

## Completed
- 2026-10-22: fixed with tests (online play review, phase B2).
