# Bug: AI pregens put prose sentences in `spells`
Status: open
Area: server (brain content)

## Overview
A pregenerated cleric got `spells` like "Spellcasting: Wisdom; spell save DC 13; …" and "Prepared
level-1 cleric spells: Bless, Cure Wounds, …" instead of spell names. The phone shows nine "?" chips
with no SRD cards or slot tables.

## Repro
Test run 2026-10-19: Party → AI pregens, "a healer cleric, a sneaky rogue" → Sister Morra Tideward.
(Sheet import of a wizard produced clean names.)

## Root cause / Fix
`Character.spells` (`packages/shared/src/schemas.ts:94`) is a bare `z.array(z.string())` with no
`.describe`, and `generatePregens` (`brain/content.ts`) never says "spell names only". Fix: add
`.describe("SRD spell names only, e.g. 'Bless'. Put spellcasting notes in features")` and a prompt
line; optionally post-process (split "X: a, b, c" lists, match SRD names).

## TODOs
- [ ] Schema describe + prompt + name normalisation test
## Completed
