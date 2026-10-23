# Feature: Per-campaign character constraints
Status: done (vertical slice)
Docs: docs/gameplay/character-constraints.md, docs/gameplay/phone-creation.md, docs/gameplay/characters.md, docs/web/host-ui.md, docs/server/http-api.md, docs/reference/tool-catalog.md

## Overview
A campaign can say what PCs may be, for example a Rat world where every hero is a Sewer Rat or Brown Rat. The host:
- defines **custom species**: the AI drafts them, then the host edits them;
- picks the **allowed species** (any mix of SRD and custom);
- ticks the **allowed classes**.

Phones, the phone AI chat, the voice builder, pregens and sheet imports block anything else. The host's own form and editor only warn.

## Notes
- **Shared:** `packages/shared/src/constraints.ts` holds `CustomSpecies` and `CharacterConstraints`, plus `checkConstraints`, `constraintsText`, `findCustomSpecies` and `cleanNames`. `Campaign.constraints` defaults to `{}`.
- **Main seam:** `GameService.creationRules().species` looks up custom species before the SRD, and `creationOptions()` filters. `resolveChoices` adds the errors through `CreationContext.constraints`.
- **Voice builder:** `updateCharacterDraft` throws on a species or class that isn't allowed, and `finalizeDraft(builder, constraints)` refuses too.
- **Pregens:** one retry, then the bad ones are dropped (`generatePregens`).
- **Brain:** `draftCustomSpecies` in `brain/content.ts`, route `POST /api/campaign/custom-species/draft`.
- **Web:** `host/CharacterRules.tsx` and `host/characterRules.ts`. Traits and choices are edited as text lines.
- Existing characters are only flagged (`RulesBadge` in PartyTab), never changed.
- The theming is not applied to NPCs, monsters or the outline. That was the user's choice (see general/decisions.md).

## TODOs
- [ ] With the real brain: "Draft species" gives balanced, SRD-shaped species, and pregens in a rat campaign come back as rats on the first try (see general/live-test-checklist.md).
- [ ] With the real voice DM: in a rat campaign the builder offers only the rat species and allowed classes, and recovers when draft_character_update refuses an Elf (see general/live-test-checklist.md).
- [ ] The phone chat's starter suggestions ("a sneaky elf…") are hard-coded, so in a constrained campaign they suggest species that aren't allowed. Consider deriving them from the options.

## Completed
- 2026-10-22: Compact custom species editor: one summary row per species (`speciesSummary` in host/seats.ts), with one form open at a time; a drafted or blank species opens on its own. The card now lives in the Party tab's collapsed Setup section.
- 2026-10-22: schema and helpers, server enforcement on every creation path, AI species drafting, the host Character rules card, rules badge and warnings, filtered phone options, docs. Checked on an isolated server: the demo party was flagged, and the phone offered only Sewer Rat / Brown Rat.
