# Feature: Characters (create / import / pregens / build by voice)
Status: done (vertical slice)
Docs: docs/gameplay/characters.md

## Overview
There are four ways to create a character, and all were requested:
- a manual form,
- pasted-sheet import (the brain parses it),
- AI pregens,
- **build by voice**, where the DM interviews one player.

Every character gets a color and an AI sprite from its `appearance`. The host override editor fixes
anything.

## Notes
- Voice builder: `state.builder` (`CharacterBuilder` in shared schemas) holds a partial
  `BuilderDraft`. Pure logic is in `apps/server/src/game/builder.ts`: `startBuilder`, `mergeDraft`,
  `missingFields`, `finalizeDraft`, `defaultMaxHp` and `builderPrompt`.
- Tools: `start_character_builder`, `draft_character_update` (Character field names, camelCase, all
  optional) and `finalize_character`. They are handled in `GameService.runTool` (not engine tools),
  because finalize goes through `addCharacter` (color, token, sprite).
- Merge rules: scalars overwrite, abilities merge per score, lists replace. Blank host fields can't
  clear a value.
- Finalize needs name, species, className and all six scores. It derives PB from level, and max HP
  from the class hit die (full die at level 1, then the average) plus CON. AC defaults to 10 + DEX.
- When the host starts a build, the DM gets a system note (`notifyDm(builderPrompt)`). When the DM
  starts it, the guidance comes back in the tool output. `buildInstructions` adds a *CHARACTER
  BUILDER ACTIVE* block while a build runs.
- The host panel is `apps/web/src/host/BuilderPanel.tsx`. It follows DM updates unless the host has
  unsaved edits.

## TODOs
- [ ] PDF upload for sheet import (currently paste text)
- [ ] Spell slots, hit dice, death saves, level-up
- [ ] Validate against SRD class/species rules (the builder trusts the DM plus lookup_rule)
- [ ] Builder: let the host clear a draft field; show inventory/attacks editing in BuilderPanel
- [ ] Builder: test with the real Realtime model (not possible without OPENAI_API_KEY here)

## Completed
- 2026-09-24: Form, import, pregens, editor, sprite redraw.
- 2026-09-24: Guided creation by talking to the DM (voice character builder): tools, live draft on
  the host and the phone, host edit/finalize/cancel, and persona guidance.
