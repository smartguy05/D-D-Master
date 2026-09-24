---
title: Creating characters
area: gameplay
topic: characters
related_code:
  - apps/web/src/host/PartyTab.tsx
  - apps/web/src/host/CharacterEditor.tsx
  - apps/server/src/brain/content.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version (form, import, pregens)"
---

# Creating characters

There are three ways to add a character (Party tab → *Add a character*). Every character gets a
color and a token sprite drawn from its species, class and **appearance** text.

## 1. Build one (form)

Fill in:
- Name, player, species, class and level.
- HP, AC, gold, and dice mode.
- The six ability scores; modifiers are shown live.
- Skills (comma separated).
- **Attacks**, one per line: `Longsword +5 1d8+3 slashing`. This is parsed into name, to-hit and
  damage.
- **Inventory**, one per line: `Torch x5`.

The proficiency bonus is derived from level.

## 2. Import a sheet

Paste anything: a D&D Beyond text export, PDF text, or handwritten notes. The brain converts it
into the character schema, keeping the sheet's numbers and inferring only what is missing, and adds
it for the selected player. This needs a configured brain.

## 3. AI pregens

Choose how many and optionally add wishes ("a healer, something sneaky, a big axe"). The brain
creates legal characters of the campaign's level that fit the adventure's hook. Each card has *Take
for…*, which adds it and assigns it to a player.

## Editing and overrides

*Edit* on a character opens the host override panel:
- HP, max HP, AC, gold and dice mode.
- Conditions: click a chip to remove it, or type to add one.
- Items: click to remove one, or type to add one.
- Appearance plus *Redraw sprite*.
- Delete.

Every change is saved and broadcast immediately. The DM's instructions refresh with the roster.

## Planned

- Guided creation by voice (talking with the DM) is not in the vertical slice yet; see
  `.memories/features/characters.md`.
- Level-up assistance and spell slot tracking.
