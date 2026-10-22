---
title: Character creation on phones
area: gameplay
topic: phone-creation
related_code:
  - packages/shared/src/creation.ts
  - apps/server/src/game/creation/*.ts
  - apps/server/src/rules/origins.ts
  - apps/server/src/rules/origins.test.ts
  - apps/server/src/rules/equipment.ts
  - apps/server/src/rules/equipment.test.ts
  - apps/server/src/brain/creation-chat.ts
  - apps/server/src/brain/creation-chat.test.ts
  - apps/server/src/game/service.creation.test.ts
  - apps/web/src/player/creation/*
  - apps/web/src/host/PhoneCreation.tsx
created: 2026-10-22
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Initial version: manual builder, AI chat helper, saved roster pick, SRD validator, host approval, play lock"
---
# Character creation on phones

Every player can create their own character on `/player/:id` (and in the `/play/:id` drawer).
There are three ways, shown as tabs:

- **Chat**: talk to an AI helper ("I want a sneaky elf"). It asks questions, fills in the sheet,
  writes the appearance and personality, answers rules questions from the SRD and can draw the
  portrait.
- **Build**: a step-by-step form (Origin, Class, Abilities, Spells, Gear, Details). Chat and Build
  edit the **same draft**, so a player can start in the chat and fine-tune in the form.
- **Saved**: heroes from the [global roster](character-roster.md). Heroes whose player name matches
  this player come first, marked "yours".

The preview card and the list of things to fix come from the server, which checks every change
against the SRD.

## Host settings (Party tab, "Character creation on phones")

Stored in `Campaign.creation` (`CreationSettings`) and `Campaign.partyLevel`:

| Setting | Default | Effect |
|---|---|---|
| Players create on their phones (`phoneCreation`) | on | Off: every draft change is refused; the phone says to ask the host |
| Starting level (`partyLevel`) | 1 | The level every phone character is built at |
| Ability scores (`abilityMethods`) | standard array, point buy | Which methods the phone offers; rolled = 4d6 drop lowest, rolled once by the server |
| Allow homebrew (`allowHomebrew`) | off | Names found in `rules/custom` (house rules) pass as warnings instead of errors |
| Lock / Unlock edits (`playStartedAt`) | unlocked | See [the play lock](#the-play-lock) |

## How a draft becomes a character

1. Each seat has one draft (`CreationDraft`) in the SQLite table `character_drafts`, **never in
   GameState**: `publicState` goes to every phone, so a draft there would leak to the other
   players, and every keystroke would land in undo history.
2. The phone PATCHes its choices (debounced 400 ms). The server merges them (`mergeChoices`), checks
   them (`resolveChoices`) and returns the view. A content-free `creation` event (`playerId`,
   `status`) tells the seat's phone and the host to refetch.
3. **Join**: a draft without errors joins at once. `CreationFlow.join` calls
   `GameService.addCharacter` with the built character (token, player link, the drawn portrait,
   or a sprite if none) and then `saveToRoster`. The draft keeps the `rosterId`, so joining again
   after an undo updates the same roster entry.
4. **Errors**: the button becomes "Send to the host for approval", with a note ("we rolled at the
   table"). The draft is `pending` until the host approves it (it joins as is) or sends it back
   with a message (`returned`; the next edit makes it a `draft` again).

A draft whose character was undone (`joined`, but the character is gone) counts as a `draft` again.
A seat that already plays another character (roster, host form, voice builder) can't join one.

## The draft stores choices; the server derives the sheet

`CreationChoices` (packages/shared/src/creation.ts) holds what the player chooses:

- name, species, `speciesChoices` (lineage, ancestry, size, skill, Versatile feat, spellcasting ability)
- class, subclass, background
- ability method, base scores, `backgroundBonuses`, ASI picks
- class skills, Fighting Style, `featPicks` (Magic Initiate, Skilled)
- cantrips and prepared spells
- equipment package letters
- optional HP/AC overrides
- appearance, personality, ideals, bonds, flaws, backstory, dice mode

`resolveChoices` (apps/server/src/game/creation/validate.ts) derives the rest:

- final scores, proficiency bonus, saves and skills;
- spells from the species and feats, plus the class picks;
- features: species traits with the chosen option, feats, and class and subclass features up to the level;
- inventory and gold from the packages;
- attacks for each starting weapon (to-hit from STR/DEX and proficiency, Archery +2);
- AC: best trained armor plus shield, Unarmored Defense, Defense +1;
- HP: the fixed value plus Dwarven Toughness.

`GameService.characterFromDraft` → `applyDerived` then adds slots, hit dice and resources, as for
every other creation path.

## What the validator checks

Errors block joining (the host can still approve); warnings are advice. Every message says what to
do, because the AI helper reads them too.

- Required: name, species, class, background, all six base scores.
- Ability method allowed. Standard array: each value once. Point buy: 8–15 and ≤ 27 points (a warning
  for points left). Rolled: exactly the server's rolled scores.
- Background bonus: +2/+1 on two different abilities, or +1/+1/+1, only among the background's
  three; no score above 20 (30 with an Epic Boon).
- One ASI pick per ASI level reached. Ability Score Improvement = +2 split. A General feat = +1 to
  its listed abilities. At level 19, an Epic Boon.
- Species choices all made with listed options. Origin feats: Magic Initiate (list, 2 cantrips and a
  level 1 spell from it, a different list when taken twice), Skilled (3 picks).
- Class skills: the class's count, from its list, none already granted by the background, species or a feat.
- Subclass: empty before the class's subclass level, required from it, the SRD subclass (or homebrew).
- Fighting Style: required when the class has it at this level; a Fighting Style feat.
- Spells: exact cantrip and prepared counts from the class table, on the class list, level ≤ the
  highest slot (Pact slot level for Warlocks), cantrips vs spells, no duplicates.
- Equipment: a listed package letter for the class and the background.
- Overrides: HP above the class maximum or AC more than 2 above the gear is an error (unless
  homebrew is allowed); any other override is a warning.

Not modelled yet: Expertise, Weapon Mastery, Eldritch Invocations and other class choices, the
Wizard's spellbook beyond prepared spells, tool choices. They go in the sheet notes or the host editor.

## SRD data

- `OriginCatalog` (apps/server/src/rules/origins.ts) parses `character-origins.md` (4 backgrounds,
  9 species) and `feats.md`. A species trait becomes a `SpeciesChoice` when it has a lineage
  table, "Choose one of the following", a size "chosen when you select this species", a skill
  choice, an Origin feat choice or "Intelligence, Wisdom, or Charisma is your spellcasting ability".
- `EquipmentCatalog` (equipment.ts) parses the Armor and Weapons tables and the
  "(A) …; or (B) 50 GP" package text (`parseEquipmentOptions`; plurals are made singular, except
  ammunition).
- `ClassCatalog` adds `skillChoices`, `equipment`, `armorTraining`, `weaponProficiency`,
  `subclassLevel` and `asiLevels` (see [rules data](../server/rules-data.md)).
- `GET /api/players/:id/creation/options` gives the phone form all of it, plus spell lists by class.

## The AI helper (Chat tab)

`POST /api/players/:id/creation/chat {text}` adds the line to the chat, sets `chatBusy` and returns.
The turn then runs in the background under `job()`.

- **Model:** the brain's provider and models, with `CREATION_TIMEOUT_MS` and
  `CREATION_REASONING_EFFORT` (`createCreationProvider`).
- **Prompt:** `brain/creation-chat.ts` builds one prompt per line:
  - the system prompt holds the hard rules, the host's methods and a compact catalog of classes,
    species with their choice keys, backgrounds and feats, and spell lists only for the chosen
    class and the Magic Initiate list;
  - the prompt holds the current choices, the derived numbers, the errors and warnings, SRD search
    results for the line (`RulesIndex.lookup`), the last 12 turns (600 characters each, 6000 in
    all) and the new line.
- **Reply:** `CreationReply {reply, patch, lookups, drawPortrait}` through `completeJson`, with
  `maxTokens` 12000 (Anthropic counts thinking against it).
- **Loop:** at most 4 calls per line (`MAX_CALLS`):
  - an optional lookup round when the model asks for SRD searches;
  - then the patch is merged and validated;
  - errors in fields the patch set go back for up to two repairs, and a repair that breaks more
    is dropped.
  - Empty values in the patch mean "no change" (structured output fills every field).
- **Result:** the accepted patch is merged onto the draft **as it is then** (the player may have
  edited in Build meanwhile). The reply is appended, then `drawPortrait` may start a portrait draw.
  A failure adds a system line ("try again, or switch to Build"). One line in flight per seat;
  another gets 409.

## Portraits

`POST …/creation/portrait {fresh}` draws from "name, a species class. appearance" with the sprite
pipeline (`drawSprite`). `fresh` skips the image cache, so a redraw gets a new picture and URL. It
is capped at 6 draws per draft and needs an image key, a name and an appearance. The portrait
becomes the character's sprite on join, and no second sprite is drawn.

## The play lock

`Campaign.creation.playStartedAt` is set the first time the DM **begins** a session (the
`opening` callback of `dmHost`, so `begin()` and not `resume()`). After that, a phone can't edit a
character that already joined ("Play has started: ask the host"). A player without a character can
still create one, and the host can still approve. The host's "Unlock edits" clears it. The next
`begin()` locks it again. Campaigns from before this feature lock at their next session start.

Before the lock, "✎ Edit <name>" on the sheet reopens the Build form. "Save changes" re-checks the
draft and applies it with `updateCharacter`:

- full HP at the new maximum;
- inventory and gold from the packages;
- the portrait;
- the roster entry is updated.

## API

Seat routes (a player cookie may only use its own seat; [auth](../server/auth.md)):

| Route | Does |
|---|---|
| `GET /api/players/:id/creation` | The `CreationView`: draft, validation, preview, level, settings, locked, hasOtherCharacter |
| `GET /api/players/:id/creation/options` | SRD options (`CreationOptions`) at the campaign level |
| `PATCH /api/players/:id/creation` `{choices, clear?}` | Merge choices; `clear` removes fields first (a record is replaced by clear + value) |
| `DELETE /api/players/:id/creation` | Start over (the draft and chat; a joined character stays) |
| `POST …/creation/roll-scores` | Roll 4d6-drop-lowest ×6, once |
| `POST …/creation/portrait` `{fresh}` | Draw the portrait in the background |
| `POST …/creation/join` | Join, or save edits |
| `POST …/creation/submit` `{note}` / `…/withdraw` | Send to the host / take it back |
| `POST …/creation/chat` `{text}` | A line to the AI helper (409 while one is in flight) |
| `GET /api/players/:id/roster`, `POST …/roster/:rosterId/join` | The Saved tab |

Host only: `GET /api/creation/pending`, `POST /api/creation/:playerId/approve`,
`POST /api/creation/:playerId/return {message}`, `POST /api/campaign/creation-lock {locked}`,
`PATCH /api/campaign/settings {partyLevel, creation}`.

## Gotchas

- Drafts live outside GameState, so undo doesn't touch them, and campaign bundles don't carry them.
  A reset without "keep players" deletes them; deleting a campaign cascades.
- `mergeChoices` clears first, then merges. Record fields (`speciesChoices`, `baseAbilities`,
  `backgroundBonuses`, `featPicks`) merge per key, so the phone sends clear + the whole record to
  replace one.
- `scrollIntoView` returns a Promise in newer Chromium: an arrow-body effect that returns it crashes
  React on unmount (`.memories/bugs/chat-effect-returns-promise.md`).
