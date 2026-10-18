---
title: SRD spell and class data
area: server
topic: rules
related_code:
  - apps/server/src/rules/spells.ts
  - apps/server/src/rules/spells.test.ts
  - apps/server/src/rules/classes.ts
  - apps/server/src/rules/classes.test.ts
  - apps/server/src/game/service.rules.test.ts
  - packages/shared/src/rules-data.ts
  - packages/shared/src/rules-data.test.ts
created: 2026-10-18
last_updated: 2026-10-18
last_audited: 2026-10-18
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-18: Initial version (SpellCatalog, ClassCatalog, shared rules-data types, EngineContext spell/classData)"
  - "2026-10-18: Review round 3: subclassMatches rejects bare category nouns and lone generic words"
  - "2026-10-18: Review round 2: type lists, span dedupe, flat damage, more area phrasings, spell aliases, length-based fuzzy distance, more notes, subclass short names"
  - "2026-10-18: Review round 1: damage roles + primaryDamage, typed/indexed upcast increments, strict find + candidates/spellCandidates, line-based parsing, save/area fixes, more class + subclass resources with notes, level clamp"
  - "2026-10-18: Link to the rules engine doc"
---

# SRD spell and class data

Structured rules data parsed from the SRD 5.2.1 Markdown at server start. It sits next to the
monster catalog (see `docs/server/rules-search.md`). The rules engine
([rules engine](../gameplay/rules-engine.md)) uses it for spell slots, casting, resources and
level-up.

## Where things live

| Piece | File | Notes |
|---|---|---|
| Types + pure helpers | `packages/shared/src/rules-data.ts` | `SpellInfo`, `ClassInfo`/`ClassData`, `ClassLevel`, `ClassResource`, `CLASS_HIT_DIE`, `hitDieFor`, `proficiencyBonusFor`, `addDice`, `spellEffectAt`, `primaryDamage`, `incrementApplies`, `resourcesFor`, `findClassFeature`. The web app can import them. |
| Spell parser | `apps/server/src/rules/spells.ts` | `parseSpellBlock`, `SpellCatalog` (`load`, `size`, `names`, `get`, `find`, `candidates`), `spellKey`, `editDistance`, and the `plainText`/`shorten` helpers |
| Class parser | `apps/server/src/rules/classes.ts` | `parseClassTable`, `parseClassSection`, `ClassCatalog` (`load`, `names`, `get`, `level`, `resourcesFor`, `featureText`) |
| Wiring | `apps/server/src/game/service.ts` | `game.spells` and `game.classes` are loaded in `init()` beside the monsters. `engineCtx()` passes `spell(name)`, `spellCandidates(name)` and `classData(className)`. `capabilities()` reports `srdSpells` and `srdClasses`. |

`builder.ts` re-exports `CLASS_HIT_DIE`, `hitDieFor` and `proficiencyBonusFor` from shared, so its
behaviour is unchanged.

## Spells (`data/srd/spells.md`)

- The file is split at every h1–h4 heading. A `#### Name` block counts as a spell **only** if its
  first line is `_Level N School (Classes)_` or `_School Cantrip (Classes)_`. This rejects rules
  sub-headings ("Spell Slots", "Using a Higher-Level Spell Slot") and the `#### Actions` /
  `#### Traits` headings inside summoned-creature stat blocks. Splitting at h2 too keeps a stat
  block (`## Otherworldly Steed`) out of the spell's text. Result: **339 spells**.
- Stat lines: `castingTime`, `range`, `components`, `duration`. Flags: `concentration` (duration
  starts with "Concentration"), `ritual` ("Ritual" in the casting time), `reaction`, `bonusAction`.
- The body is read **line by line**. The level line and each `**Casting Time:**` / `**Range:**` /
  `**Components:**` / `**Duration:**` line are dropped one at a time, because the SRD sometimes
  puts the first description paragraph straight after the Duration line. Lines starting with
  `_Using a Higher-Level Spell Slot._` or `_Cantrip Upgrade._` start their own section, even with
  no blank line before them.
- From the description (with the upgrade sections left out):
  - `save`: the save the spell *forces*, using the phrasings "makes/make/succeed on/fails a(n)/another
    <Ability> saving throw". "Advantage on … saving throws" (Haste, Gaseous Form) and similar
    clauses are ignored;
  - `attack`: "melee/ranged spell attack";
  - `damage[]` (in text order), each `{dice, type, role, addMod?}`. Overlapping matches are
    merged into one; the same dice and type at two different places stay separate hits (Searing
    Smite's start-of-turn 1d6, Wall of Fire's end-of-turn 5d8):
    - `NdM(+K) <Type> damage`;
    - type lists `NdM A or B damage` / `NdM A, B, C, or D damage` (Forbiddance, Glyph of Warding):
      the first type is `base` (or the role from context), the others `or`;
    - `<Type> damage (to the target) equal to NdM (plus your spellcasting ability modifier)` sets
      `addMod: true` (Spiritual Weapon);
    - "base damage is NdM" (Delayed Blast Fireball) takes its type from the first
      "<Type> damage" in the text;
    - if no type is named ("3d8 damage of the chosen type"), every such match is a `"choice"` entry
      (Conjure Elemental 8d8 + later 4d8);
    - with no dice anywhere, flat `N <Type> damage` (Guardian of Faith: `20` radiant).
  - `role` (`DamageRole`) says how an entry combines with the others:
    - `base` is dealt together with the other base entries (Ice Storm, Flame Strike, Meteor Swarm,
      Ice Knife);
    - `or` is an alternative to the entry before it, when the text between them has "or" and no
      sentence break (Spirit Guardians, Fire Shield);
    - `later` is a staged or separately triggered hit. It needs a timing cue between the entries
      ("at the end of each of its turns", "first time", "Turn 2.", "ends its turn") or in the rest
      of the entry's sentence ("… at the end of its next turn", "… each creature that ends its turn
      within 10 feet"). Examples: Acid Arrow,
      Vitriolic Sphere, Wall of Thorns, Wall of Ice, Weird, Tsunami, Storm of Vengeance.
    - **Mode spells** (`OPTION_SPELLS`): Prismatic Spray (a d8 picks the ray), Prismatic Wall (one
      entry per layer) and Arcane Hand (Clenched Fist or Grasping Hand). For these, the first
      entry is `base` and every other entry is `or`, so `primaryDamage` gives one ray, layer or
      hand. Roll or pick the real one from `summary`.
  - `heal`: "regains Hit Points equal to 2d8 plus your spellcasting ability modifier" gives
    `{dice, addMod: true}`. "regains/restoring 70 Hit Points" gives `addMod: false`;
  - `area`: the earliest of `N-foot(-radius) Sphere|Cone|Cube|Emanation`; cylinders written
    radius first or height first, with "high" or "tall" and a hyphen or space ("50-foot-radius,
    100-foot high", "40-foot-tall, 20-foot-radius", "20-foot-tall"), and "Cylinder that is 10 feet
    tall with a 60-foot radius"; lines written length first, width first ("5-foot-wide, 60-foot-long")
    or as "Line … 60 feet long and 10 feet wide" (`widthFt`). Size limits such
    as "no larger than a 5-foot Cube", "fit in a 5-foot Cube" and "can't exceed 50 contiguous
    10-foot Cubes" are skipped (Minor Illusion and Druidcraft have no area);
  - `projectiles`: "three darts/rays/beams". It is 1 for a cantrip whose upgrade adds beams
    (Eldritch Blast).
- `upcast` (from `_Using a Higher-Level Spell Slot._`) has these fields:
  - `text`;
  - `perLevelDice`, the first increase;
  - `appliesTo`: damage, heal or both;
  - `perLevelTargets` ("one additional creature");
  - `perLevelProjectiles` ("one more dart");
  - `damageIncrements[]` of `{dice, types?, roles?, index?}`, one per "increases by X" clause:
    - damage types named in the clause become `types` ("The Cold damage" → `["cold"]`;
      "The Fire damage and the Radiant damage" → both);
    - by default an increase applies to every role ("The damage increases", "All the damage",
      "Both types"), so later hits scale too. "The initial damage" (without "later") gives
      `roles: [base, or]` (Vitriolic Sphere);
    - when several clauses name no type (Wall of Ice, Arcane Hand), each one gets `index` k and
      applies to the k-th damage entry.
  - Flat amounts work too (Heal: +10 per level).
- `cantripScaling` (from `_Cantrip Upgrade._`): `tiers` such as `[{level:5,dice:"2d10"},…]`.
  Eldritch Blast gives `projectiles` tiers instead.
- `summary`: the first ~300 characters of plain text.
- `spellEffectAt(spell, {slotLevel?, casterLevel?})` returns the numbers for one casting:
  `castLevel`, `damage` (each matching increment added per slot level above the spell's own),
  `heal`, `projectiles` and `extraTargets`. A cantrip scales by caster level. The slot level is
  clamped to the range from the spell's level to 9.
- `primaryDamage(effect | spell)` gives the entries to roll when the spell takes effect: every
  `base` entry, plus the first entry of an `or` group that has no base. `later` entries are rolled
  when they trigger.

### Lookup (`find`, `get`, `candidates`)

- `spellKey(name)` is the key: lower case, with every non-alphanumeric character removed. That
  covers apostrophes (straight or curly), spaces and slashes, so "fire ball" → `fireball` and
  "enlarge reduce" → `enlargereduce`.
- `get(name)`: exact key only.
- `find(name)` is **strict**. It first drops a leading "the " and a trailing " spell", then checks
  the alias table `SPELL_ALIASES` (older wizard names: Melf's Acid Arrow, Tasha's Hideous
  Laughter, Bigby's Hand/Clenched Fist/Forceful/Grasping/Interposing Hand → Arcane Hand,
  Mordenkainen's Sword → Arcane Sword, Nystul's Magic Aura → Arcanist's Magic Aura, Cure Light
  Wounds → Cure Wounds, …; a test checks every target exists). Then, ignoring queries shorter
  than 3 characters, it tries:
  1. an exact key;
  2. a **unique** prefix ("Disinteg" → Disintegrate; "Fire" and "Prismatic" are ambiguous);
  3. a **unique** spell within `fuzzyDistanceFor(len)`: 0 below 5 characters, 1 for 5–7, 2 for 8+
     ("Magic Missle" → Magic Missile; "links" is not Blink; "Fireboll" is ambiguous).

  If that fails and the query starts with a possessive ("Zorbo's fireball"), the rest is tried the
  same way. Anything else returns `undefined`. It never guesses between several spells.
- `candidates(name, limit = 5)`: the nearest names for "did you mean …", over spell names and
  aliases (and the possessive-stripped query). Prefix matches come first, then contains, then edit
  distance, up to max(2, ⌈len/2⌉).
  - The engine gets these as `ctx.spellCandidates(name)`.

Known limits:
- Damage written in prose without dice ("damage equal to twice the number of feet") is not
  captured, and neither is per-target damage inside summoned stat blocks. Read
  `summary`/`upcast.text` for those.
- Roles and increments come from heuristics. Spells outside the tested set could be classified
  wrongly; the tests cover 20+ multi-damage spells.
- Mode spells (`OPTION_SPELLS`) and the alias table are lists kept by hand.

## Classes (`data/srd/classes.md`)

Each `## Class` section with a `**<Class> Features**` table gives a `ClassInfo`:

- `hitDie` (from "Hit Point Die: D12…") and `savingThrows`.
- `spellcasting`: `ability` (from "X is your/the spellcasting ability for your …") and `kind`.
  The kind comes from the table: 9 slot columns means `full`, 5 means `half`, and the
  `Spell Slots` + `Slot Level` columns mean `pact` (Warlock). Barbarian, Fighter, Monk and Rogue
  have no `spellcasting`.
- `levels[20]`: `level`, `proficiencyBonus`, `features` (Class Features column split on commas;
  `—` becomes `[]`), `slots` (index 0 = level 1, trailing zeros trimmed), `pact {slots, slotLevel}`,
  `cantrips`, `preparedSpells`, `resources` (numeric resource columns, by resource name) and
  `columns` (every other column as raw text, e.g. `Rage Damage: "+2"`, `Martial Arts: "1d6"`,
  `Sneak Attack: "1d6"`).
  - Parsing: the header comes from the first `<thead>` row, and `colspan="N"` expands into N slot
    columns. Each body row is cut to the header length, which drops the trailing empty `<td>` that
    some tables have.
- `features[]` / `subclass {name, features[]}`: one entry per `#### Level N: Name` under
  `### <Class> Class Features` or `### <Class> Subclass: <Name>`. `text` is the plain text,
  cut to at most 400 characters. `ClassData.featureText(name)` (and `ClassCatalog.featureText`)
  looks a feature up by name. Before comparing, both names are lowercased, curly apostrophes are
  straightened and a trailing "( … )" is dropped, so "Action Surge (one use)" and "Nature’s Veil"
  resolve. It tries an exact match first, then a prefix, and class features before subclass ones.

### Resources (`resourcesFor(cls, level, abilities, subclass?)`)

`RESOURCE_COLUMNS` maps table columns to resource names: Rages → Rage, Channel Divinity,
Wild Shape, Second Wind, Focus Points, Sorcery Points, Favored Enemy. A hand-written rule list
(taken from the SRD feature text) then gives `{name, max, resetOn, shortRestRegain?, note?}`.
`note` is a short DM-facing line for recovery that isn't a plain rest: regaining on Initiative,
partial recovery, or restoring a use by spending something else. The engine just shows it.

| Class | Resource (min level) | Max | Reset / note |
|---|---|---|---|
| Barbarian | Rage | Rages column | Long; regain 1 on a Short Rest |
| Barbarian | Persistent Rage (15) | 1 | Long; note: regain all Rage on Initiative |
| Bard | Bardic Inspiration | CHA mod (min 1) | Long; Short or Long from 5 (Font of Inspiration, note: spend a slot to regain one); note at 18 (Superior Inspiration) |
| Cleric | Channel Divinity | column | Long; regain 1 on a Short Rest |
| Cleric | Divine Intervention (10) | 1 | Long; note at 20: Wish → unusable for 2d4 Long Rests |
| Druid | Wild Shape | column | Long; regain 1 on a Short Rest; note at 20 (Evergreen) |
| Druid | Wild Resurgence (5) | 1 | Long; note: Wild Shape use → level 1 slot |
| Druid | Nature Magician (20) | 1 | Long |
| Fighter | Second Wind | column | Long; regain 1 on a Short Rest |
| Fighter | Action Surge (2) | 1, 2 at 17 | Short |
| Fighter | Indomitable (9) | 1 / 2 at 13 / 3 at 17 | Long |
| Monk | Focus Points | column | Short; note at 15 (Perfect Focus) |
| Monk | Uncanny Metabolism (2) | 1 | Long; note: on Initiative regain all Focus + heal |
| Paladin | Channel Divinity | column | Long; regain 1 on a Short Rest |
| Paladin | Lay On Hands | 5 × level (HP pool) | Long |
| Paladin | Paladin's Smite (2), Faithful Steed (5) | 1 each | Long (free Divine Smite / Find Steed) |
| Ranger | Favored Enemy | column | Long (free Hunter's Mark) |
| Ranger | Tireless (10), Nature's Veil (14) | WIS mod (min 1) | Long |
| Rogue | Stroke of Luck (20) | 1 | Short |
| Sorcerer | Sorcery Points | column | Long |
| Sorcerer | Innate Sorcery | 2 | Long |
| Sorcerer | Sorcerous Restoration (5) | 1 | Long; note: on a Short Rest regain ≤ half level SP |
| Warlock | Magical Cunning (2) | 1 | Long; note: regain half the Pact slots (all at 20, Eldritch Master) |
| Warlock | Contact Patron (9) | 1 | Long |
| Warlock | Mystic Arcanum (level 6/7/8/9) (11/13/15/17) | 1 each | Long; one resource per arcanum |
| Wizard | Arcane Recovery | 1 | Long; note: slots worth ≤ half level on a Short Rest |
| Wizard | Signature Spells (20) | 2 | Short (one cast of each spell) |

Subclass rules apply only when `subclass` names **the class's own** SRD subclass (a Warlock given
"Path of the Berserker" gets nothing). `subclassMatches(srdName, given)` accepts the full name in
any case, a run of whole words inside it ("Berserker", "Open Hand", "Fiend", "Draconic", "Land",
"Devotion", "Champion", "Thief", "Life", "Hunter"), or an alias ("Evocation"/"School of Evocation"
→ Evoker, "Way of the Open Hand", "Draconic Bloodline", "The Fiend"). A query made only of stop words
and category nouns (path, domain, circle, college, oath, patron, sorcery, warrior, conclave, school,
way), such as "Path" or "Path of the", never matches. Neither does a lone generic word ("Hand",
"Open"); "Open Hand" does.

| Subclass | Resource (min level) | Max | Reset / note |
|---|---|---|---|
| Path of the Berserker | Intimidating Presence (14) | 1 | Long; note: restore with a Rage use |
| Circle of the Land | Natural Recovery (spell), Natural Recovery (slots) (6) | 1 each | Long |
| Warrior of the Open Hand | Wholeness of Body (6) | WIS mod (min 1) | Long |
| Oath of Devotion | Holy Nimbus (20) | 1 | Long; note: restore with a level 5 slot |
| Draconic Sorcery | Dragon Wings (14), Dragon Companion (18) | 1 each | Long |
| Evoker | Overchannel (14) | 1 | Long; note: first use free, later uses 2d12 Necrotic per slot level (+1d12 each) |
| Fiend Patron | Dark One's Own Luck (6) | CHA mod (min 1) | Long |
| Fiend Patron | Hurl Through Hell (14) | 1 | Long; note: restore with a Pact slot |

Other rules:
- `resetOn: "short"` means a Short or a Long Rest restores everything.
- The level is clamped once (to at most 20), and below 1 (or NaN) the result is `[]`.
- Resources whose max is 0 at that level are left out.
- Spell slots are not resources. Pact Magic slots come back on a Short Rest, per the Pact Magic
  text.

## Tests

- `apps/server/src/rules/spells.test.ts` runs on real data. It covers the count (339), rejected
  non-spell headings, Fireball, Fire Bolt and Eldritch Blast scaling, Bless/Shield/Detect
  Magic/Healing Word flags, Cure Wounds and Heal healing, Chromatic Orb's chosen type, Magic
  Missile darts, Hold Person, Lightning Bolt/Burning Hands areas, Scorching Ray, the review-round
  parse fixes (line-based sections, save, area, damage patterns), damage roles and typed/indexed
  increments, scaling math (clamp to 9, floor at the spell's level) and strict `find`/`candidates`.
- `apps/server/src/rules/classes.test.ts` runs on real data. It checks 12 classes × 20 levels, hit
  dice and PB against the shared tables, caster kinds and abilities, the Wizard, Paladin and
  Warlock slots, Barbarian 3 features and Rage, resources for every class and subclass, minimum
  levels (Magical Cunning 2), the level clamp, and feature text (suffixes, curly apostrophes).
- `packages/shared/src/rules-data.test.ts` covers the pure helpers.
- `apps/server/src/game/service.rules.test.ts` checks that `init()` loads both catalogs and that
  `engineCtx()` exposes them.
