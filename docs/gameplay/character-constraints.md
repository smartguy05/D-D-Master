---
title: Character constraints (per campaign)
area: gameplay
topic: character-constraints
related_code:
  - packages/shared/src/constraints.ts
  - packages/shared/src/constraints.test.ts
  - apps/server/src/game/service.constraints.test.ts
  - apps/web/src/host/CharacterRules.tsx
  - apps/web/src/host/characterRules.ts
  - apps/web/src/host/characterRules.test.ts
created: 2026-10-22
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Character rules moved under Party tab Setup; compact species rows"
  - "2026-10-22: Initial version: custom species, allowed species/classes, enforcement per creation path"
---
# Character constraints (per campaign)

A campaign can limit what its heroes may be. A Rat world, for example, says every PC is a Sewer Rat
or a Brown Rat, and only Rogues, Fighters and Rangers. The host sets this on the **Party tab → Setup →
Character rules** card. Each custom species there is a one-line summary that opens into its form.

## What the host sets

`Campaign.constraints` (`packages/shared/src/constraints.ts`, default `{}`, so old campaigns load):

| Field | Meaning |
|---|---|
| `customSpecies` | Species the campaign defines, in the same shape as an SRD species (`SpeciesInfo`): creature type, speed, darkvision, cantrips, traits, choices (size, lineage…), plus a `description` of how they look. |
| `allowedSpecies` | SRD and/or custom species names PCs may be. **Empty = any species.** A lineage passes ("Wood Elf" counts as an allowed "Elf"). |
| `allowedClasses` | Class names PCs may be; subclasses follow their class. **Empty = every class.** |

Custom species are usually **drafted by the AI**: the host types a prompt ("three rat species for a
sewer city"), `POST /api/campaign/custom-species/draft` runs `draftCustomSpecies`
(`brain/content.ts`), and the drafts are added to the card (and to the allowed list). Nothing is saved
until the host presses **Save rules** (`PATCH /api/campaign/settings {constraints}`). Traits and choices
are edited as text lines: `Name: rules text` and `Label [option|size|skill|feat|ability]: A / B`
(`characterRules.ts`; option extras such as a lineage's cantrips survive while the option names
don't change). Two custom species may not share a name.

The species and class pickers list every SRD name from `GET /api/rules/origins`, plus the custom species.
When every class is ticked, the card saves `[]` ("no restriction").

## Enforcement

The pure check is `checkConstraints(character, constraints)`. It returns issues with the codes
`species_not_allowed` and `class_not_allowed`, and the messages list what is allowed.

| Path | Behaviour |
|---|---|
| Phone Build form | `GameService.creationOptions` lists only allowed species (custom first) and classes; `resolveChoices` errors on anything else, which blocks Join. A custom species resolves through `creationRules().species` (custom first, then SRD), so its speed, traits and choices are checked like an SRD one. |
| Phone AI chat | Same filtered catalog, plus a HARD RULE block from `constraintsText`. The repair loop feeds the errors back. |
| Voice builder | `builderSteps` lists the allowed options. `updateCharacterDraft` refuses a patch with a disallowed species/class (the error lists the allowed ones). `finalizeDraft` refuses too, and takes the custom species' speed and trait names. |
| AI pregens | The rules go in the prompt. Characters that break them get one retry, then are dropped; if none are left, the call throws. |
| Sheet import | Refused with an error that lists the issues. |
| Host form / editor | **Not enforced** (host override): a red warning under the fields. |
| Host roster pick | Not enforced (host action). |

When the rules change, existing characters are **never changed**. The Party tab shows
"⚠ breaks character rules" on each one's seat (⚠ in the seat list) that now breaks them, with the issues as a tooltip.

The rules cover characters only. NPCs, monsters and the outline are not themed. Sprite and portrait
prompts add a custom species' `description`, so a "Sewer Rat Rogue" is drawn as a rat.

## Gotchas

- `CustomSpecies` is a zod schema. `SpeciesInfo` stays an interface, and a type assertion in
  `constraints.ts` keeps the two compatible.
- `constraints.ts` imports only zod plus a type from `creation.ts`. Because `schemas.ts` imports it,
  any runtime import from `schemas.ts` would create a cycle.
- `allowHomebrew` does not get around the constraints: a homebrew species that isn't on the allow-list is
  still an error.
