# Bug: derive dropped hand-added resources and host-patched fields
Status: fixed (2026-10-18)
Area: server (engine/rules)

## Overview
MEDIUM. `deriveClassResources` rebuilt `resources` from the class rules only, so a level_up or a host level edit deleted feat/magic-item resources the host had added. A host patch with `level` plus `spellSlots` was also overwritten by the re-derive.

## Repro
Add a "Luck Points" resource to a Fighter 1, `level_up` → gone. `updateCharacter(id, {level: 5, spellSlots: [... 3 level-3 slots]})` → back to 2.

## Root cause / Fix
Derive keeps resources whose names the class rules never produce (checked against `resourcesFor(cls, 20, …, srd subclass)`); `updateCharacter` re-applies patch `spellSlots`/`pactSlots`/`resources`/`hitDice` after deriving. Tests: derive.test.ts, level.test.ts, service.rules.test.ts.

## Notes
Found by the A2 adversarial review, round 1.

## TODOs

## Completed
- 2026-10-18: Fixed with tests (stream A2 review round 1).
