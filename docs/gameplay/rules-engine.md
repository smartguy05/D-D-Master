---
title: Rules engine (spells, rests, levels, death saves)
area: gameplay
topic: rules
related_code:
  - apps/server/src/engine/rules/**
  - packages/shared/src/schemas.rules.test.ts
  - apps/server/src/game/service.rules.test.ts
created: 2026-10-18
last_updated: 2026-10-18
last_audited: 2026-10-18
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-18: Initial version (cast_spell, rests, level_up, death saves, concentration, old-save upgrade)"
  - "2026-10-18: Review round 1: revive tool (heal refuses the dead), first-turn death save, kept hand-added resources and patched fields, level-up wakes a downed PC, one-slot-per-turn warning, pending-roll fixes, Exhaustion forms"
  - "2026-10-18: Review round 2: ALL_CLASS_RESOURCE_NAMES (class change drops old class resources), host HP edit wakes a downed PC, kind=check uses the pending DC"
---

# Rules engine

The rules engine tracks spell slots, Pact Magic, Hit Point Dice, class resources, Death Saving
Throws and Concentration for player characters, following the SRD 5.2.1 text in `data/srd`. The
SRD data comes from the spell and class catalogs ([rules data](../server/rules-data.md)). The
voice DM calls the tools; the host can call the same tools through `POST /api/tools/:name`.
Monsters keep the simple rules: 0 HP means Dead, with no slots and no concentration.

## Code

| File | What |
|---|---|
| `apps/server/src/engine/rules/derive.ts` | `deriveClassResources(char, classData)`, `applyDerived`, `upgradeCharacters` (old saves), compact summaries (`rulesSummary`, `rulesStatus`) |
| `apps/server/src/engine/rules/vitals.ts` | 0 HP, massive damage, death saves, Stable, concentration checks, `requestPhysical` (the pending-roll policy), the `death_save`/`stabilize`/`end_concentration` tools |
| `apps/server/src/engine/rules/cast.ts` | `cast_spell` |
| `apps/server/src/engine/rules/rests.ts` | `short_rest`, `long_rest`, `use_resource` |
| `apps/server/src/engine/rules/level.ts` | `level_up`, `subclassLevel` |
| `apps/server/src/engine/rules/index.ts` | `RULES_TOOLS` and `RULES_HANDLERS`, which are spread into `ENGINE_TOOLS` and the handler map in `engine/tools.ts` |
| `apps/server/src/engine/rules/testing.ts` | Test-only helpers: an `EngineContext` on the real SRD catalogs, `seq` dice and `makeCharacter` |

Handlers stay pure. They change only the cloned state that `executeEngineTool` gives them, and
every change goes through `GameService.runTool`, so it can be undone.

## Character state

The new `Character` fields are `subclass`, `spellSlots[] {level,max,used}`,
`pactSlots? {level,max,used}`, `hitDice {die,max,used}`, `deathSaves {successes,failures,stable}`,
`concentration {spell,since} | null` and `resources[] {name,max,used,resetOn,shortRestRegain?,note?}`.
Every one of them has a default (see [game state](../reference/game-state.md#character)).

`deriveClassResources` reads the SRD class table for the character's class and level, plus
`resourcesFor(...)` for resources. It keeps every `used` value and caps it at the new max. It is
used:
- when a character is created (`GameService.characterFromDraft`, which covers the form, import,
  pregens and the voice builder);
- by `level_up`;
- by `GameService.updateCharacter` when the host changes `className`, `level` or `subclass` (a
  level change also resets PB unless the patch sets it);
- for **old saves**, by `upgradeCharacters`. It runs in `loadCampaign` (the upgraded state is
  saved) and at the start of every `commit`, which covers restored history snapshots and imports.
  A character counts as not yet derived when `hitDice.max === 0`. Characters that already have
  values are never touched.

A class that is not in the SRD (for example "Artificer") gets only hit dice, using a d8. Slots
and resources the host set by hand for it are kept. For an SRD class, resources whose names no
SRD class or subclass rule produces (`ALL_CLASS_RESOURCE_NAMES` in `packages/shared/src/rules-data.ts`:
feats, magic-item charges, homebrew) are kept too; class resources the character no longer
qualifies for (another class after a class change, another subclass, a lower level) are dropped. When a host patch changes the level and also sends
`spellSlots`, `pactSlots`, `resources` or `hitDice`, the sent values win. A host HP edit that takes
a downed (not Dead) PC above 0 HP counts as regaining HP (`regainedHp`: Unconscious removed, saves
reset, pending death save cleared), unless the patch sets `conditions` or `deathSaves` itself.

## Casting spells

`cast_spell {caster_id, spell, slot_level?, as_ritual?, target_ids?, x?, y?}`:

1. Name lookup is strict (`ctx.spell`). An unknown or ambiguous name returns
   `{error, did_you_mean}` and spends nothing. A caster at 0 HP or with an Incapacitating
   condition gets `{error}`.
2. Which slot is spent:
   - **Cantrip**: no slot. Damage scales with the character level ("Cantrip Upgrade").
   - **`as_ritual`**: no slot, but only for Ritual spells. "The Ritual version of a spell takes 10
     minutes longer to cast than normal. It also doesn't expend a spell slot, which means the
     ritual version of a spell can't be cast at a higher level." Without `as_ritual`, a Ritual spell
     spends a slot like any other. **Decision:** casting without a slot has to be an explicit
     choice.
   - **Warlock**: a Pact Magic slot, and the spell is cast at the pact slot level. If the pact slots
     are spent and there is no matching regular slot, the error says they return on a Short Rest.
     A level 6+ spell uses that level's **Mystic Arcanum** resource.
   - **Otherwise**: exactly one slot of `slot_level` (default: the spell's level). **Decision:**
     the engine never quietly spends a higher slot. If that slot is used up, the error lists
     `free_slots` (levels ≥ the spell's level that still have a slot), and the DM retries with
     `slot_level`. A `slot_level` below the spell's level is an error.
3. **One slot per turn.** SRD: "On a turn, you can expend only one spell slot to cast a spell."
   During combat, a second slot (or pact slot) spent by the same caster in the same round and turn
   adds a `warning`; it is not refused. `Character.slotTurn {round, turn}` records the turn, and
   `start_combat`/`end_combat` clear it. Cantrips, rituals and Mystic Arcanum don't count.
   Mystic Arcanum asked for at a higher `slot_level` warns that it is cast at its own level.
4. **Concentration.** "You lose Concentration on an effect the moment you start casting a spell
   that requires Concentration." The new spell replaces the old one, and `ended_concentration`
   names the spell that ended.
5. The result gives `spent`, `cast_level`, `slots_left` or `pact_left`, casting time, range and
   duration. It also gives:
   - `save {ability, dc}` with DC = 8 + PB + spellcasting modifier;
   - `attack_bonus` = PB + modifier;
   - `damage[]` (`primaryDamage` at the cast level), `or_damage[]` (alternatives) and
     `later_damage[]` (staged hits such as the end-of-turn damage of *Acid Arrow*). A
     `+ spellcasting modifier` entry gets the modifier added;
   - `heal`, `projectiles`, `extra_targets`, `area {shape,sizeFt}`, `targets` and `summary`;
   - `not_on_sheet: true` when the spell is not in `character.spells`. The cast still happens; this
     is only a warning.

   The spellcasting ability is the class's. For a non-SRD or non-caster class it is the highest of
   INT, WIS and CHA.
6. **Revival spells** (Revivify, Raise Dead, Resurrection, True Resurrection) with a dead target in
   `target_ids` add a `hint` to call `revive`. They never revive on their own: the DM narrates the
   spell's conditions (Revivify's 1-minute limit, components) first.
7. **Hook for animations:** `EngineOutcome.cast = {casterId, spell, castLevel, effect, targetIds, x, y}`
   (`SpellCast` in `engine/tools.ts`). Nothing reads it yet; spell effects on the table will be
   emitted from it.

## Rests

Both rests skip a character at 0 HP. The SRD says: "To start a Short Rest, you must have at least
1 Hit Point." For those characters the result says `skipped`.

**Short Rest** (`short_rest {character_ids, hit_dice?: {id: count}}`):
- Hit Dice: "For each Hit Point Die you spend in this way, roll the die and add your Constitution
  modifier to it. You regain Hit Points equal to the total (minimum of 1 Hit Point)." The engine
  rolls each die with `ctx.rng` and emits it as a roll (3D dice). It stops early when HP is full
  and never spends more dice than are left. `hit_dice` keys can be ids or names.
- Pact Magic: "You regain all expended Pact Magic spell slots when you finish a Short or Long Rest."
- Resources: those with `resetOn: "short"` (Action Surge, Focus Points, …) reset. Long-rest
  resources with `shortRestRegain` (Rage, Channel Divinity, Wild Shape, Second Wind) get that many
  uses back.
- Regular spell slots do **not** come back. `options` reminds the DM of unused features that act
  on a Short Rest (Arcane Recovery, Sorcerous Restoration, Natural Recovery). The DM applies those
  by hand (for example with `use_resource` and a host slot edit).

**Long Rest** (`long_rest {character_ids?}`, default: the whole party):
- "You regain all lost Hit Points and all spent Hit Point Dice." (This is 2024: all of them, not
  half.)
- All spell slots, Pact slots and resources are restored ("You regain all expended slots when you
  finish a Long Rest" for every caster class, and likewise each feature's own text).
- Temporary HP drops to 0: they "last until they're depleted or you finish a Long Rest".
- Death saves are cleared. Concentration ends: "During sleep, you have the Unconscious condition."
- Exhaustion goes down one level: "Exhaustion 2" becomes "Exhaustion 1", and "Exhaustion" or
  "Exhaustion 1" is removed. "Exhaustion: 2" and "Exhaustion (2)" are read too.

`use_resource {character_id, resource, amount=1}` spends uses by exact or prefix name, and a
negative amount gives uses back. It refuses to spend more uses than are left.

## Level up

`level_up {character_id, hp: "average"|"roll", subclass?}` follows "Level Advancement". It:
- refuses a Dead PC (`{error}`). A PC at 0 HP who gains HP wakes up (Unconscious removed, saves
  reset, pending death save cleared);
- adds the HP gain to max HP and to current HP: "Roll that die, add your Constitution modifier to
  the roll, and add the total (minimum of 1) to your Hit Point maximum. Instead of rolling, you can
  use the fixed value" (die/2 + 1). A roll is emitted;
- sets the level and PB, and re-derives Hit Dice, slots, Pact slots and resources. Spent uses stay
  spent, because levelling up is not a rest;
- adds the new class features for that level (from the table row's Class Features column, with the
  text of the matching feature heading, so a repeated feature such as Ability Score Improvement at
  4, 8, 12… is reported each time but added to `features` once), and the subclass features once the subclass matches
  the SRD subclass (`subclassMatches`, which stores the SRD name: "Evocation" becomes "Evoker").
  Their names go into `features`, and `new_features[]` has `{name, text}` with the text cut to
  about 200 characters. The table's "<Class> Subclass" placeholder is skipped;
- **subclass gate**: when the new level is at or past the class's subclass level (3 for every SRD
  class, from the table's "<Class> Subclass" entry) and the character has no subclass, it returns
  `{error, subclass_options: [SRD subclass]}` and changes nothing. A subclass that is not in the
  SRD is stored with a `note` (add its features by hand);
- for a non-SRD class: d8 HP and no features, with a `note`. Level 20 is the maximum.

## Death Saving Throws

These are automatic in `apply_damage`, `heal`, `next_turn` and `record_physical_roll`, following
"Dropping to 0 Hit Points" in `playing-the-game.md`:

| Event | Rule (SRD quote) | Engine |
|---|---|---|
| Damage takes a PC to 0 | "If you reach 0 Hit Points and don't die instantly, you have the Unconscious condition" | `Unconscious`, saves reset, concentration ends |
| Overflow ≥ max HP | "the character dies if the remainder equals or exceeds their Hit Point maximum" | `Dead` (temp HP absorbs first; only damage that reaches HP counts) |
| Damage at 0 HP | "you suffer a Death Saving Throw failure. If the damage is from a Critical Hit, you suffer two failures instead. If the damage equals or exceeds your Hit Point maximum, you die." | +1 failure (`critical: true` +2); ≥ max HP: `Dead` |
| Stable and damaged | "If the creature takes damage, it stops being Stable" | `stable = false`, and the failure counts |
| Turn starts at 0 HP | "Whenever you start your turn with 0 Hit Points, you must make a Death Saving Throw" | `next_turn` rolls it (virtual) or sets `pendingRoll` kind `death_save` (physical) |
| d20 ≥ 10 / < 10 | "If the roll is 10 or higher, you succeed. Otherwise, you fail." | success / failure |
| Natural 1 / 20 | "When you roll a 1 … you suffer two failures. If you roll a 20 … you regain 1 Hit Point." | 2 failures / 1 HP, conscious, saves reset |
| 3 successes | "you become Stable"; counts are "reset to zero when you regain any Hit Points or become Stable" | `stable = true`, counts 0, still Unconscious at 0 HP |
| 3 failures | "On your third failure, you die." | `Dead` (failures shown as 3) |
| Any healing | Unconscious lasts "until you regain any Hit Points" | saves reset, conscious, pending death save cleared |
| Healing a Dead PC | "A dead creature has no Hit Points and can't regain them unless it is first revived by magic" | `heal` returns `{error}`; `revive {character_id, hp=1}` brings the PC back |

Also:
- `start_combat` keeps downed (not dead) PCs in the initiative order, so they get turns to make
  death saves, and makes the death save at once when such a PC has the first turn. `next_turn` skips dead PCs and dead monsters.
- `stabilize` covers a successful DC 10 Medicine check or *Spare the Dying*. `death_save` rolls
  outside the turn order.
- The engine does not track the rule "A Stable creature that isn't healed regains 1 Hit Point
  after 1d4 hours". The DM applies it with `heal`.

## Concentration

From the "Concentration" entry in the Rules Glossary:
- **Damage**: "you must succeed on a Constitution saving throw to maintain Concentration. The DC
  equals 10 or half the damage taken (round down), whichever number is higher, up to a maximum DC
  of 30." The full damage counts, temp HP included. The bonus is the CON mod, plus PB when the
  sheet's `savingThrows` or the class's saving throws include CON (Sorcerer, Fighter, Barbarian).
  With virtual dice the save is rolled at once and shown on the TV. With physical dice the engine
  sets `pendingRoll` kind `concentration` with the DC. A failed save ends concentration.
- **Incapacitated or dead**: dropping to 0 HP, dying, or `add_condition` with Incapacitated,
  Unconscious, Paralyzed, Petrified or Stunned ends it with no save.
- **Another concentration spell**: `cast_spell` replaces it (see above). `end_concentration` drops
  it at will. Ending concentration in any way clears that character's pending concentration save.

## Physical dice and the single pendingRoll

There is only one `pendingRoll` slot, and its `kind` is `check`, `death_save` or `concentration`.
- An automatic request (a death save or a concentration save) **never overwrites** a pending roll,
  including a first concentration save of the same character (a second hit asks for "a second"
  save at its own DC). The result's `instruction` tells the DM to record the pending one first,
  then ask for this roll and call `record_physical_roll` with `kind=…` (and `dc`). A repeated death
  save request for the same character just points at the one already waiting.
- `request_player_roll` still overwrites the pending roll. If the old one was a death save or a
  concentration save, `replaced` warns the DM to ask for it again.
- `record_physical_roll` uses `kind` from its args, else the kind of that character's pending roll,
  else `check`. An explicit `kind: "check"` while the character has a pending death or
  concentration save is applied as that save, against the pending roll's DC (the pending roll is
  what the DM asked for), with a `warning`. A death save total must be the bare d20 (1–20). The roll clears only that
  character's pending roll. A phone's number pad (`submitPhysicalRoll`) answers death and
  concentration saves the same way.

## Party status and DM instructions

`get_party_status` adds these per character: `subclass`, `slots` ("1:2/4 2:0/3", left/max per
level), `pact` ("L3 1/2"), `hitDice` ("4/5 d6"), `concentration`, `deathSaves` while at 0 HP, and
`resources` (["Rage 2/3"]). The DM's PARTY line ends with the same data in compact form (`rulesSummary`), for example
`slots 1:2/4 2:0/3; HD 4/5 d6; conc Bless; DOWN saves S1 F2; Rage 2/3`. Resource notes are left
out to keep the instructions small. The persona has one MECHANICS bullet that names `cast_spell`,
`short_rest`/`long_rest`, `level_up` and `use_resource`, and says that death saves and
concentration checks are automatic.

## Tests

- `engine/rules/derive.test.ts`: Wizard and Warlock tables, keeping and capping `used`, subclass
  gating, a non-SRD class, purity, the old-save upgrade fixture and the summaries.
- `engine/rules/vitals.test.ts`: dropping to 0, massive damage (the SRD example), temp HP,
  failures and crits at 0 HP, Stable then damage, virtual and physical death saves (nat 20, nat 1,
  three successes and three failures), heal resets, stabilize, `next_turn` auto-saves (and skipping
  Stable and dead PCs), initiative with downed PCs, concentration DC, CON proficiency, physical
  saves, the pending-roll conflict policy, incapacitating conditions, and purity.
- `engine/rules/cast.test.ts`: Wizard 5 Fireball at 3 and at 5, the exact-slot errors, Fire Bolt
  scaling at 5, rituals, swapping concentration, `did_you_mean`, heal, later damage, Warlock pact
  slots, Eldritch Blast, Mystic Arcanum, and purity.
- `engine/rules/rests.test.ts`: rolling Hit Dice (min 1, stop when full, limits), pact slots and
  resources on a Short Rest, Arcane Recovery staying spent, the ≥ 1 HP rule, a multi-target Long
  Rest, Exhaustion, `use_resource`, and purity.
- `engine/rules/level.test.ts`: Wizard 1 → 2 → 3 with the subclass gate, rolled HP, keeping spent
  values, PB at 5, new resources, Warlock pact slots, later subclass features, non-SRD subclasses
  and classes, level 20, and purity.
- `packages/shared/src/schemas.rules.test.ts`: old-shape characters and pending rolls parse.
- `game/service.rules.test.ts`: values derived on create, old-save load (persisted), re-deriving
  on host level edits, undo for `cast_spell` (a failed cast leaves no history), a phone's physical
  death save, and the builder subclass.
- `realtime/instructions.test.ts`: the single MECHANICS bullet and the compact PARTY line.
