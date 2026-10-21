---
title: Creating characters
area: gameplay
topic: characters
related_code:
  - apps/web/src/host/PartyTab.tsx
  - apps/web/src/host/CharacterEditor.tsx
  - apps/server/src/brain/content.ts
  - apps/web/src/host/BuilderPanel.tsx
  - apps/server/src/game/builder.ts
  - apps/server/src/game/builder.test.ts
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-21
audited_by: claude
status: current
change_log:
  - "2026-10-20: No behaviour change (content.ts stateSummary: split note)"
  - "2026-10-20: drafts never set lightRadius"
  - "2026-10-20: Bring an existing hero from the character roster"
  - "2026-10-20: Pregen/import spell lists normalised; Party tab survives tab switches"
  - "2026-10-20: Saving throws field; class saves filled when empty"
  - "2026-09-24: Initial version (form, import, pregens)"
  - "2026-09-24: Build by voice (character builder)"
  - "2026-10-18: Hit die / proficiency bonus tables moved to packages/shared/src/rules-data.ts"
  - "2026-10-18: Rules state derived at creation; builder subclass; level-up and slots moved to rules-engine.md"
---

# Creating characters

There are five ways to add a character: three in Party tab → *Add a character*, one by talking
to the DM (**🗣 Build by voice**), and *Bring an existing hero* from the global
[character roster](character-roster.md), which copies a hero saved in an earlier campaign. Every character gets a
color and a token sprite drawn from its species, class and **appearance** text.

## 1. Build one (form)

Fill in:
- Name, player, species, class and level.
- HP, AC, gold, and dice mode.
- The six ability scores; modifiers are shown live.
- Skills (comma separated).
- Saving throws (comma separated, e.g. `STR, CON`). Leave it empty for the class's.
- **Attacks**, one per line: `Longsword +5 1d8+3 slashing`. This is parsed into name, to-hit and
  damage.
- **Inventory**, one per line: `Torch x5`.

The proficiency bonus is derived from level (`proficiencyBonusFor` in
`packages/shared/src/rules-data.ts`, next to the class hit dice `CLASS_HIT_DIE`/`hitDieFor`; the
parsed SRD class tables are checked against both in `rules/classes.test.ts`).

New characters start with the default light (a torch, 6 cells of fog reveal); a draft's `lightRadius` is ignored.

Every new character (form, import, pregen or voice builder) gets its **rules state** derived from
the SRD class table in `GameService.characterFromDraft` (`deriveClassResources`,
`apps/server/src/engine/rules/derive.ts`): spell slots, Pact Magic slots, Hit Point Dice (one per
level) and class resources (Rage, Second Wind, Arcane Recovery…). The brain never fills these in:
`CharacterDraft` omits them. See [rules engine](rules-engine.md).

**Saving throw proficiencies**: a character with none (the form left empty, an import or pregen
that skipped them) gets its SRD class's (`defaultSavingThrows`, `engine/rules/saves.ts`), both at
creation (`applyDerived`) and for old saves (`upgradeCharacters` on load/commit). An explicit list
is kept.

## 2. Import a sheet

Paste anything: a D&D Beyond text export, PDF text, or handwritten notes. The brain converts it
into the character schema, keeping the sheet's numbers and inferring only what is missing, and adds
it for the selected player. This needs a configured brain.

## 3. AI pregens

Choose how many and optionally add wishes ("a healer, something sneaky, a big axe"). The brain
creates legal characters of the campaign's level that fit the adventure's hook. Each card has *Take
for…*, which adds it and assigns it to a player. Generation takes a minute or two; the host can
switch tabs meanwhile (the Party tab stays mounted, so results and drafts survive).

Spell lists from pregens and sheet imports go through `normalizeSpellList` (`brain/spells.ts`):
prose such as "Prepared level-1 cleric spells: Bless, Cure Wounds" becomes SRD names, notes in
parentheses, `[R]` tags and `x2` counts are dropped, and names the SRD spell catalog knows are
kept (whole names first, so "Protection from Evil and Good" survives). Pregens drop other entries
unless none matched; sheet imports keep short name-like entries as homebrew spells.

## 4. Build by voice (character builder)

The DM interviews one player and builds the character with them, like a session zero.

1. **Start it.** On the Party tab, press **🗣 Build by voice** next to the player
   (`POST /api/builder/start`). The DM can also start it: when a player asks to make a character, it
   calls `start_character_builder {player_id, level?}`. The level defaults to the campaign's party
   level. `state.builder = {playerId, playerName, level, draft, startedAt, updatedAt}` is created,
   and only one build runs at a time. When the host starts it, the running DM gets a *CHARACTER
   BUILDER* system note, which switches it into interview mode. While a build is active,
   `buildInstructions` also adds a *CHARACTER BUILDER ACTIVE* block with the draft and what is still
   missing.
2. **Interview.** The DM asks about concept, species, class, background, ability scores (standard
   array or point buy), skills, equipment, spells, name and look. It uses `lookup_rule` for SRD
   details. After each decision it calls `draft_character_update` with only the new fields. These
   use the `Character` field names: `name, species, className, subclass, background, abilities, maxHp, ac,
   speed, skills, savingThrows, attacks, spells, features, inventory, gold, appearance, notes,
   diceMode`. The merge rules are in `apps/server/src/game/builder.ts` `mergeDraft`:
   - Scalars overwrite.
   - `abilities` merge per score.
   - Lists replace the old list.
   - Invalid values (a score over 30, an unknown dice mode) are rejected.

   The tool returns the draft, `missing` (required) and `suggested` fields.
3. **Live draft.** The host Party tab shows an editable **BuilderPanel** at the top: name, species,
   class, background, level, HP, AC, the six scores, skills, spells and appearance. It saves through
   `PATCH /api/builder {draft, level?}`. It follows the DM's updates unless the host has unsaved
   edits. A blank field in the panel keeps the stored value (it can't clear a field). The player's
   phone shows a read-only version ([player view](../web/player-view.md)).
4. **Finalize.** The DM calls `finalize_character`, or the host presses **✔ Finalize character**
   (`POST /api/builder/finalize`). It needs `name`, `species`, `className` and all six ability
   scores; otherwise it returns `{ok:false, missing}`. Missing values are derived:
   - Proficiency bonus from level.
   - Max HP from the class hit die: the full die at level 1, plus the average (die/2 + 1) for each
     later level, plus the CON modifier per level. Unknown classes use a d8.
   - AC defaults to 10 + DEX modifier.
   - Speed defaults to 30.

   The character is created through the normal `addCharacter` path. It is assigned to the player, it
   gets a color and token, and its sprite is drawn. The builder is then cleared. **Cancel**
   (`DELETE /api/builder`) discards the draft and tells the DM to resume.

This works without a running DM too: the host can fill in the draft by hand and finalize it.

## Editing and overrides

*Edit* on a character opens the host override panel:
- HP, max HP, AC, gold and dice mode.
- Conditions: click a chip to remove it, or type to add one.
- Items: click to remove one, or type to add one.
- Appearance plus *Redraw sprite*.
- Delete.

Every change is saved and broadcast immediately. The DM's instructions refresh with the roster.

Changing `className`, `level` or `subclass` through the host override (`updateCharacter`)
re-derives slot, Hit Die and resource maxima (spent uses are kept) and, for a level change, the
proficiency bonus.

## Levelling up, slots and rests

`level_up`, `cast_spell`, `short_rest`, `long_rest`, `use_resource`, death saves and
concentration are covered in [rules engine](rules-engine.md).
