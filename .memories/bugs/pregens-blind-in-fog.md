# Bug: Fog didn't clear around characters (pregens with lightRadius 0)
Status: fixed (2026-10-20)
Area: brain / server / fog

## Overview
In the market and the cistern the fog only cleared under the lanterns and on the PCs' own cells;
walking into the dark revealed nothing. Both PCs (pregens) had `lightRadius: 0`.

## Repro
Generate pregens with the OpenAI brain, enable fog, move a PC into an unlit area.

## Root cause / Fix
`CharacterDraft` (brain/content.ts) still included `lightRadius`. OpenAI structured output fills
every optional field, so the model wrote 0 ("no light"). Fix: `CharacterDraft` omits
`lightRadius`; `characterFromDraft` drops it as well (pregens cached before the fix); a host
`updateCharacter` with `lightRadius` now runs `revealAroundCharacters` at once. The live campaign
(cmp_fc62fc3580) was patched to 6 via the host API. Tests: content.pregens.test.ts,
game/service.light.test.ts.

## Notes
- Other optional Character fields the brain fills may get model-chosen zero values too; audit if
  something similar shows up (e.g. diceMode is defaulted and harmless).
- While debugging, `tsx watch` had stopped reloading the server (general/environment.md).

## TODOs
- [ ] Check characters in older campaigns/roster for `lightRadius: 0` and offer a fix.

## Completed
- 2026-10-20: Fixed with regression tests; live campaign patched.
