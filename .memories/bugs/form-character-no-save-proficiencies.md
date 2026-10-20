# Bug: characters from the Build one form have no saving throw proficiencies
Status: fixed (2026-10-20)
Area: web (host Party tab) / server (character derive)

## Overview
A Fighter made with *Build one* shows STR save +3 and CON save +2 on the phone (ability modifier
only). An SRD Fighter is proficient in STR and CON saves (+5 / +4 at level 2). The form has no
saving-throw field and the server doesn't fill them from the class.

## Repro
Test run 2026-10-19: Brienne Saltblade (Human Fighter 2, form) → phone sheet Abilities.

## Root cause / Fix
`savingThrows` defaults to `[]`; the class catalog (`classData`) isn't used for it. Fix: default
`savingThrows` from the SRD class when empty (form, import and pregens), and show them in the form.

## TODOs
## Completed
- [x] 2026-10-20: Default class save proficiencies + test
- 2026-10-20: defaultSavingThrows (engine/rules/saves.ts) fills empty savingThrows from the SRD class in applyDerived (create) and upgradeCharacters (load/commit); the form has a Saving throws field. Tests: saves.test.ts, service.rules.test.ts, derive.test.ts.
