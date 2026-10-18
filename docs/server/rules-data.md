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
---

# SRD spell and class data

Structured rules data parsed from the SRD 5.2.1 Markdown at server start. It sits next to the
monster catalog (see `docs/server/rules-search.md`). The rules engine uses it for spell slots,
casting, resources and level-up.

## Where things live

| Piece | File | Notes |
|---|---|---|
| Types + pure helpers | `packages/shared/src/rules-data.ts` | `SpellInfo`, `ClassInfo`/`ClassData`, `ClassLevel`, `ClassResource`, `CLASS_HIT_DIE`, `hitDieFor`, `proficiencyBonusFor`, `addDice`, `spellEffectAt`, `resourcesFor`, `findClassFeature`. The web app can import them. |
| Spell parser | `apps/server/src/rules/spells.ts` | `parseSpellBlock`, `SpellCatalog` (`load`, `size`, `names`, `get`, `find`), and the `plainText`/`shorten` helpers |
| Class parser | `apps/server/src/rules/classes.ts` | `parseClassTable`, `parseClassSection`, `ClassCatalog` (`load`, `names`, `get`, `level`, `resourcesFor`, `featureText`) |
| Wiring | `apps/server/src/game/service.ts` | `game.spells` and `game.classes` are loaded in `init()` beside the monsters. `engineCtx()` passes `spell(name)` and `classData(className)`. `capabilities()` reports `srdSpells` and `srdClasses`. |

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
- From the description (with the upgrade paragraphs left out):
  - `save`: the first "<Ability> saving throw";
  - `attack`: "melee/ranged spell attack";
  - `damage[]`: every `NdM(+K) <Type> damage`, deduplicated. When no type is named
    ("3d8 damage of the chosen type"), the type is `"choice"`;
  - `heal`: "regains Hit Points equal to 2d8 plus your spellcasting ability modifier" gives
    `{dice, addMod: true}`. "regains/restoring 70 Hit Points" gives `addMod: false`;
  - `area`: `N-foot(-radius) Sphere|Cone|Cube|Emanation`, `N-foot-radius, H-foot-high Cylinder`,
    and the two Line phrasings (`widthFt`);
  - `projectiles`: "three darts/rays/beams".
- `upcast` (from `_Using a Higher-Level Spell Slot._`): `text`, plus `perLevelDice` with
  `appliesTo` damage|heal|both, `perLevelTargets` ("one additional creature") and
  `perLevelProjectiles` ("one more dart"). Flat amounts work too (Heal: +10 per level).
- `cantripScaling` (from `_Cantrip Upgrade._`): `tiers` such as `[{level:5,dice:"2d10"},…]`.
  Eldritch Blast gives `projectiles` tiers instead.
- `summary`: the first ~300 characters of plain text.
- `find(name)` normalises case and punctuation, then tries exact, then prefix, then contains.
- `spellEffectAt(spell, {slotLevel?, casterLevel?})` returns the numbers for one casting:
  `castLevel`, scaled `damage` (the per-level dice go onto the first damage entry), `heal`,
  `projectiles` and `extraTargets`. A cantrip scales by caster level. A slot below the spell's
  level counts as the spell's own level.

Known limits: per-level dice apply only to the first damage entry. Spells that list several
options ("Radiant or Necrotic") keep every type. Damage written in prose without dice (for example
"damage equal to your level") is not captured. Read `summary`/`upcast.text` for those.

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
  looks a feature up by name. It tries an exact match first, then a prefix, and class features
  before subclass ones.

### Resources (`resourcesFor(cls, level, abilities)`)

`RESOURCE_COLUMNS` maps table columns to resource names: Rages → Rage, Channel Divinity,
Wild Shape, Second Wind, Focus Points, Sorcery Points, Favored Enemy. A hand-written rule list
(taken from the SRD feature text) then gives `{name, max, resetOn, shortRestRegain?}`:

| Class | Resource | Max | Reset |
|---|---|---|---|
| Barbarian | Rage | Rages column | Long; regain 1 on a Short Rest |
| Bard | Bardic Inspiration | CHA mod (min 1) | Long; Short or Long from level 5 (Font of Inspiration) |
| Cleric | Channel Divinity | column | Long; regain 1 on a Short Rest |
| Cleric | Divine Intervention (10+) | 1 | Long |
| Druid | Wild Shape | column | Long; regain 1 on a Short Rest |
| Fighter | Second Wind | column | Long; regain 1 on a Short Rest |
| Fighter | Action Surge (2+) | 1, 2 at 17 | Short |
| Fighter | Indomitable (9+) | 1 / 2 at 13 / 3 at 17 | Long |
| Monk | Focus Points | column | Short |
| Monk | Uncanny Metabolism (2+) | 1 | Long |
| Paladin | Channel Divinity | column | Long; regain 1 on a Short Rest |
| Paladin | Lay On Hands | 5 × level (HP pool) | Long |
| Ranger | Favored Enemy (free Hunter's Mark) | column | Long |
| Rogue | Stroke of Luck (20) | 1 | Short |
| Sorcerer | Sorcery Points | column | Long |
| Sorcerer | Innate Sorcery | 2 | Long |
| Sorcerer | Sorcerous Restoration (5+) | 1 | Long |
| Warlock | Magical Cunning (2+) | 1 | Long |
| Wizard | Arcane Recovery | 1 | Long |

`resetOn: "short"` means a Short or a Long Rest restores everything. Resources whose max is 0 at
that level are left out. Spell slots are not resources. Pact Magic slots come back on a Short
Rest, per the Pact Magic text.

## Tests

- `apps/server/src/rules/spells.test.ts` runs on real data. It covers the count (339), rejected
  non-spell headings, Fireball, Fire Bolt and Eldritch Blast scaling, Bless/Shield/Detect
  Magic/Healing Word flags, Cure Wounds and Heal healing, Chromatic Orb's chosen type, Magic
  Missile darts, Hold Person, Lightning Bolt/Burning Hands areas, Scorching Ray and `find`.
- `apps/server/src/rules/classes.test.ts` runs on real data. It checks 12 classes × 20 levels, hit
  dice and PB against the shared tables, caster kinds and abilities, the Wizard, Paladin and
  Warlock slots, Barbarian 3 features and Rage, resources for every class, and feature text.
- `packages/shared/src/rules-data.test.ts` covers the pure helpers.
- `apps/server/src/game/service.rules.test.ts` checks that `init()` loads both catalogs and that
  `engineCtx()` exposes them.
