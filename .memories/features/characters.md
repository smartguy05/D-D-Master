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
  `missingFields`, `finalizeDraft`, `defaultMaxHp` and `builderPrompt`. `CLASS_HIT_DIE`, `hitDieFor`
  and `proficiencyBonusFor` now live in `packages/shared/src/rules-data.ts` (builder re-exports them).
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
- Rules state (`spellSlots`, `pactSlots`, `hitDice`, `deathSaves`, `concentration`, `resources`)
  is derived in `GameService.characterFromDraft` via `applyDerived` (engine/rules/derive.ts);
  `CharacterDraft` (brain) omits those fields. `BuilderDraft` has `subclass`.
- The host panel is `apps/web/src/host/BuilderPanel.tsx`. It follows DM updates unless the host has
  unsaved edits.

- Host rules controls live in `apps/web/src/host/RulesPanel.tsx` (`RestControls`, `QuickActions`,
  `RulesEditor`). Slots/Pact are adjusted with `PATCH /api/characters/:id` (`adjustSlots`), resources
  with `use_resource` (±1), level-up retries with the picked subclass when the tool returns
  `subclass_options`. All view logic is in `apps/web/src/player/sheet.ts` (tested).

## TODOs
- [ ] Host: edit the subclass / add hand-made resources directly (now only via level_up or JSON)
- [ ] PDF upload for sheet import (currently paste text)
- [ ] Validate against SRD class/species rules (the builder trusts the DM plus lookup_rule)
- [ ] Builder: let the host clear a draft field; show inventory/attacks editing in BuilderPanel
- [ ] Builder: test with the real Realtime model (not possible without OPENAI_API_KEY here)

## Completed
- 2026-10-20: Bring an existing hero from the global character roster (Party tab); Save/Update
  roster buttons (see features/character-roster.md).
- 2026-10-20: Pregen/import spell lists normalised to SRD names (`brain/spells.ts`); class saving throws filled when empty; Party tab survives tab switches.
- 2026-09-24: Form, import, pregens, editor, sprite redraw.
- 2026-09-24: Guided creation by talking to the DM (voice character builder): tools, live draft on
  the host and the phone, host edit/finalize/cancel, and persona guidance.
- 2026-10-18: Hit die / PB tables moved to shared rules-data; SRD class tables parsed (ClassCatalog).
- 2026-10-18: Spell slots, Pact slots, hit dice, death saves, concentration, resources and
  level-up (rules engine, see `.memories/features/rules-engine.md` and docs/gameplay/rules-engine.md).
  Characters get these derived at creation; old saves are upgraded on load; the builder takes a
  `subclass`.
- 2026-10-18: Host Party tab rules UI: Short Rest panel (hit dice per PC), Long Rest, Level up
  (average/roll, subclass picker), slot/Pact/resource adjusters, Stabilize/Revive/End
  concentration, compact rules line; TV PartyCard death-save pips, Stable and concentration badges.
  Editor fields now follow server changes (`.memories/bugs/host-editor-stale-fields.md`).
