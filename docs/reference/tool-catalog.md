---
title: DM tool catalog
area: reference
topic: tools
related_code:
  - apps/server/src/realtime/npc-voice.ts
  - packages/shared/src/tools.ts
  - apps/server/src/engine/tools.ts
  - apps/server/src/game/builder.ts
  - apps/server/src/engine/rules/index.ts
created: 2026-09-24
last_updated: 2026-10-18
last_audited: 2026-10-18
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-09-24: Added speak_as_npc (23 tools)"
  - "2026-09-24: Initial version (22 tools)"
  - "2026-09-24: start_character_builder, draft_character_update, finalize_character"
  - "2026-09-24: reveal_area, set_fog, play_effect; automatic effects and fog reveal"
  - "2026-10-18: spawn_monster defaults to the map focal feature"
  - "2026-10-18: set_monster_hidden, host-only edit_fog and edit_map_feature, HOST_ONLY_TOOLS"
  - "2026-10-18: set_monster_hidden: hidden monsters still act; expect_name; repaint drops edits"
  - "2026-10-18: edit_map_feature box numbers must be finite"
  - "2026-10-18: speak_as_npc is queued behind the DM audio"
  - "2026-10-18: spawn_monster near, formation, fog, hidden (planSpawn layout)"
  - "2026-10-18: move_token redirect reason; host may use blocking cells"
  - "2026-10-18: Rules engine: cast_spell, end_concentration, use_resource, short_rest, long_rest, level_up, death_save, stabilize; apply_damage critical; record_physical_roll kind; automatic death saves and concentration"
  - "2026-10-18: heal refuses the dead, revive tool, start_combat first-turn death save, record kind=check warning, cast_spell warning/hint"
  - "2026-10-18: Attack/spell animations: roll_dice/request_player_roll target_id + attack_name, apply_damage source_id + attack_name, cast_spell effects, play_effect attack/area kinds"
  - "2026-10-18: Animation review 1: unresolved damage source = plain hit, spells under attacks, magical ranged = spell, Melee-or-Ranged by distance, spell-attack orbs travel only, darts never 0"
  - "2026-10-18: remove_monster keeps the current turn"
---

# DM tool catalog

The Realtime DM calls these tools, and the host can call them through `POST /api/tools/:name`.
The schemas are in `packages/shared/src/tools.ts`. Ids can be replaced by names, which are resolved
by exact match, then player name, then prefix.

| Tool | Args | Effect / returns |
|---|---|---|
| `get_party_status` | — | Location, grid, characters (HP, AC, conditions, dice mode, gold, items, pos, plus `subclass`, `slots` "1:2/4 2:0/3" (left/max), `pact` "L3 1/2", `hitDice` "4/5 d6", `concentration`, `deathSaves` while at 0 HP, `resources` ["Rage 2/3"]), monsters (HP, AC, attacks, pos), combat order |
| `roll_dice` | `notation, label, roller_id?, secret?, dc?, target_id?, attack_name?` | Rolls; the TV animates it. With `target_id` (attack roll, not secret) the TV also animates the attack from the roller to the target (see automatic effects). Returns total, dice (dropped in parentheses), modifier, natural 20 or 1, success |
| `request_player_roll` | `character_id, notation, label, dc?, target_id?, attack_name?` | Virtual: rolls now (an attack with `target_id` is animated). Physical: sets `pendingRoll` (kind `check`, with `targetId`/`attackName`) and returns an instruction; `replaced` warns when it overwrote a pending death or concentration save |
| `record_physical_roll` | `character_id, notation, label, total, dc?, kind?` | Records a spoken physical result and clears that character's `pendingRoll`. `kind` (default: the pending roll's kind) `death_save` applies the d20 (1–20) as a death save, `concentration` keeps or ends concentration against `dc`. `kind: "check"` while that character has a pending death or concentration save is applied as the pending save, with a `warning`. A pending check with a `targetId` animates the attack (outcome from `dc`) |
| `apply_damage` | `target_id, amount, damage_type?, critical?, source_id?, attack_name?` | Temp HP first, clamped at 0. Monster at 0: Dead. PC: the [SRD 0-HP rules](../gameplay/rules-engine.md#death-saving-throws) (Unconscious, massive damage, failures at 0 HP, 2 on `critical`) and a concentration save. Returns HP plus `down`, `dead`/`cause`, `death_saves`, `concentration`, `concentration_ended` |
| `heal` | `target_id, amount` | Clamped at max HP; clears Unconscious; resets death saves and clears a pending death save. A Dead PC: `{error}` pointing to `revive`, nothing changes |
| `set_temp_hp` | `target_id, amount` | Keeps the higher of the old and new values (5e rule) |
| `add_condition` / `remove_condition` | `target_id, condition` | Title-cased, no duplicates. Incapacitated, Unconscious, Paralyzed, Petrified or Stunned ends a PC's concentration (`concentration_ended`) |
| `give_item` | `character_id, name, qty=1, description?` | Stacks by case-insensitive name |
| `remove_item` | `character_id, name, qty=1` | Exact or partial name; removes the entry at 0 |
| `adjust_gold` | `character_id, amount` | Negative spends; errors if it can't be afforded |
| `move_token` | `entity_id, x, y` | Clamped to the grid; nudged to the nearest free cell if occupied, or (DM only) under a `blocks` feature, returning `redirected: true, reason`. The host may place tokens on blocking features |
| `spawn_monster` | `name, count=1, x?, y?, near?, formation=cluster\|arc\|line, fog=any\|revealed\|hidden, hidden=false, hp?, ac?` | SRD stats when the name matches; numbered names; sprites generated. Tokens are laid out by `planSpawn` around x/y, else the `near` feature (name: exact, prefix, whole word, contains; unknown name lists the features), else the focal feature, else right-middle: never on `blocks` features or other tokens, 3+ squares from the party when there is room (not when an exact x and y are given), preferring the `fog` side. `hidden=true` spawns them hidden from the TV (ambush) |
| `remove_monster` | `monster_id` | Removes the monster, its token and its initiative entry. The current turn stays on the same creature (removing the current one passes the turn to the next) |
| `start_combat` | — | Rolls initiative for everyone not dead (downed PCs too: they make death saves; hidden monsters included); returns the order. If the first creature is a downed, unstable PC, its death save is made (`death_save`) |
| `next_turn` | — | Next combatant (skips dead monsters and dead PCs); round increments on wrap. Landing on a PC at 0 HP who is not Stable makes its death save (`death_save` in the result: rolled now for virtual dice, `pendingRoll` kind `death_save` for physical) |
| `end_combat` | — | Clears combat |
| `change_scene` | `location_id` (id or name) | New map, monsters cleared, party placed, instructions refreshed |
| `lookup_rule` | `query` | Top SRD and house-rule passages (about 2500 characters) |
| `consult_brain` | `question` | Planner guidance (up to 120 words) from the outline, recaps and recent play |
| `confirm_speaker` | `player_name` (player or character) | Sets the active speaker and teaches that player's voiceprint the last uncertain sample |
| `speak_as_npc` | `npc_name, line (1-400 chars), style?` | Only offered with `NPC_TTS=1`. Synthesizes the line in that NPC's own voice (speech API, NPC `voice` direction plus `style`), saves an mp3, queues it (broadcast as `npc_speech` once the DM's audio stops; the DM's next response waits until `/table` reports the clip ended or clip length + 1.5 s), logs it. Returns `{ok, playing}`; `{ok:false, error}` when NPC voices are off |
| `start_character_builder` | `player_id` (id or name), `level?` | Starts the voice character builder (`state.builder`). Returns the empty draft, what is missing, and interview guidance |
| `draft_character_update` | Any `Character` fields: `name, species, className, subclass, background, abilities{…}, maxHp, ac, speed, skills[], savingThrows[], attacks[], spells[], features[], inventory[{name,qty,description?}], gold, appearance, notes, diceMode` (all optional) | Merges into the live draft. Abilities merge per score and lists replace. Returns `{player, level, draft, missing, suggested}` |
| `finalize_character` | — | Validates (needs name, species, className and six scores), derives HP/AC/PB, creates and assigns the character, and clears the builder. `{ok:false, missing}` if incomplete |

| `cast_spell` | `caster_id, spell, slot_level?, as_ritual?, target_ids?, x?, y?` | Spends a slot (exactly `slot_level`, default the spell's level; Warlocks a Pact slot at the pact level, Mystic Arcanum for 6+; cantrips and `as_ritual` free), swaps concentration. Returns `spent`, `cast_level`, `slots_left`/`pact_left`, `save {ability, dc}`, `attack_bonus`, `damage[]`, `or_damage[]`, `later_damage[]`, `heal`, `projectiles`, `area`, range, duration, `ended_concentration`, `not_on_sheet`, `summary`, `warning` (a second slot in the same combat turn; Mystic Arcanum above its level), `hint` (a revival spell at a dead target: call `revive`). Unknown or ambiguous name: `{error, did_you_mean}`; no free slot: `{error, free_slots}` (nothing spent). See [rules engine](../gameplay/rules-engine.md#casting-spells) |
| `end_concentration` | `character_id` | Ends concentration; returns `ended` (spell or null) |
| `use_resource` | `character_id, resource, amount=1` | Spends uses of a class feature (exact, then prefix name); negative gives uses back. Errors when not enough are left or the name is unknown (lists the character's resources) |
| `short_rest` | `character_ids[], hit_dice?: {id: count}` | Per character with ≥ 1 HP: rolls each Hit Die + CON (min 1, stops at full HP), Pact slots back, `resetOn: short` features reset, `shortRestRegain` uses back. Returns per character `hit_dice_spent, healed, hp, hit_dice_left, recovered, options` (e.g. Arcane Recovery) or `skipped` |
| `long_rest` | `character_ids?` (default everyone) | Per character with ≥ 1 HP: full HP, temp HP 0, all Hit Dice, slots, Pact slots and features, death saves cleared, concentration ended, Exhaustion −1 |
| `level_up` | `character_id, hp=average\|roll, subclass?` | +1 level: HP (die/2+1 or a rolled die, + CON, min 1) to max and current, PB, Hit Dice, slots, resources, new class + subclass features (added to `features`, short text in `new_features`). At the subclass level without one: `{error, subclass_options}`. Non-SRD class: d8, no features, `note` |
| `death_save` | `character_id` | A death save out of turn order (virtual: rolled now; physical: `pendingRoll` kind `death_save`). Stable: `rolled: false` |
| `revive` | `character_id, hp=1` | Brings a Dead PC back after a revival spell (or a DM ruling): removes Dead and Unconscious, sets HP (capped at max), resets death saves. Not dead: error (use `heal`) |
| `stabilize` | `character_id` | Stable at 0 HP (still Unconscious, saves reset), e.g. after a DC 10 Medicine check or *Spare the Dying* |

The builder tools run in `GameService` (logic in `apps/server/src/game/builder.ts`), not the pure engine.
See [characters](../gameplay/characters.md#4-build-by-voice-character-builder).
| `reveal_area` | `x, y, radius=3` or `x, y, w, h` | Adds a circle (dx²+dy² ≤ r²+r) or a rectangle (top-left x, y) to the current location's revealed cells, clipped to the grid. Works even while fog is off (pre-reveal). Returns new and total revealed cells |
| `set_fog` | `mode: enable \| disable \| reset` | Fog of war for the current location. `reset` forgets explored cells; the party's light is re-revealed immediately |
| `set_monster_hidden` | `monster_id, hidden=true` | Hides a monster from the table (map token, foes list, initiative strip, effects on it) for ambushes or invisibility, or shows it again. It still rolls initiative and acts; `get_party_status` marks it `hidden: true`. Monsters only |
| `edit_fog` | `cells: [x,y][], mode: reveal \| hide` | **Host only.** `reveal` adds cells and un-hides them; `hide` removes them from the revealed set and adds them to `fog.hidden`, which auto-reveal skips. Off-grid cells are ignored |
| `edit_map_feature` | `action: add \| update \| delete \| reset, index?, expect_name?, feature?` | **Host only.** Edits the current map's effective features into `state.featureEdits[loc]` (keyed to the current `mapUrl`, so a repaint resets it). `add` needs a full feature; `update` merges the given fields; `expect_name` makes update/delete fail if the feature at `index` has another name (stale index); box numbers must be finite; they are rounded, lifted to x/y ≥ 0 and w/h ≥ 1, and clamped to the grid; `reset` drops the edit. A map repaint also drops it. Refreshes the DM instructions |
| `play_effect` | `kind, target_id?, source_id?, x?, y?, radius?` | A visual on the table only (no state change). `kind`: hit, crit, miss, heal, slash, fireball, lightning, frost, poison, radiant, necrotic, thunder, arcane, attack (travel from `source_id`), area (ring of `radius`). Needs `target_id` or `x, y` |

**Automatic effects** (no tool call needed; `apps/server/src/engine/effects.ts`):
- `apply_damage` with amount > 0 emits a `hit` (tinted by `damage_type`). With `source_id` it also
  carries the source and a travel `style` when the attack resolves (`attack_name`, else the source's
  only attack); otherwise, and for area spells (Fireball damage), it stays a plain hit with no
  travel. `critical` → outcome `crit`.
- `heal` emits `heal`.
- An attack roll (`roll_dice`, `request_player_roll`, or `record_physical_roll` of a pending check)
  with a known `target_id`, not secret, emits one `attack` effect: `style` melee/ranged/spell from
  the attacker's attack matched by `attack_name` or the label (monster attacks keep "Melee/Ranged
  Attack Roll" in `description`; an entry without that text named exactly like an SRD spell, e.g. a
  PC's "Fire Bolt", is that spell; a ranged attack with a non-physical damage type is a spell orb;
  "Melee or Ranged" is melee within 1 cell of the target, else ranged), else an SRD spell of that
  name, else weapon keywords (bow, crossbow, sling, dart, javelin, blowgun, net, thrown);
  `outcome` natural 20 → crit, natural 1 → miss (the kept die with advantage), else vs `dc` (none
  without a dc). Any visible roll that produced no attack effect (no or unknown target) with a
  natural 20 or 1 emits `crit` or `miss` on the roller.
- `cast_spell` (success only): spell attack → a travel-only `attack` orb per target (no outcome;
  the attack roll that follows brings hit/miss/crit); darts without an attack roll (Magic Missile)
  → orbs with outcome `hit`, `count` = darts split over the targets (≤ 6 each, never 0: with fewer
  darts than targets only the first targets get one); area → one `area` effect at `x, y`, else the first target, else
  the caster (emanations on the caster), `radius` = sphere/emanation/cylinder ft/5, cube and cone
  half their size, line half its width (a line with targets flies an orb to each instead); other
  damaging spells → an element burst (`fireball`, `frost`, `radiant`…) on each target; healing →
  `heal`; anything else → `arcane` on the targets or the caster. **Automatic reveal**: after every engine tool, when
fog is on, each character reveals a circle of its `lightRadius` (default 6) around its token.
**Automatic rules** (engine/rules, see [rules engine](../gameplay/rules-engine.md)): PC damage
applies the SRD 0-HP and death-save rules and asks for a concentration save; `next_turn` makes a
downed PC's death save. Physical-dice players get a `pendingRoll` of kind `death_save` or
`concentration`, applied by `record_physical_roll`.

**Host-only tools** (`HOST_ONLY_TOOLS` in `packages/shared/src/tools.ts`: `edit_fog`,
`edit_map_feature`) are filtered out of the Realtime tool list (`dmToolDefs`) and `runTool` refuses
them when the source is the DM. The host's Board tab calls them through `POST /api/tools/:name`.

Adding a tool:
1. Add its schema and description in `ToolArgs` and `TOOL_DESCRIPTIONS`.
2. Add a handler in `engine/tools.ts` (list it in `ENGINE_TOOLS`), a rules handler in
   `engine/rules/*.ts` (listed in `RULES_TOOLS`/`RULES_HANDLERS` in `engine/rules/index.ts`), or a
   case in `GameService.runTool`.
3. Add a test and update this table.
4. If the DM should use it proactively, mention it in the persona in `realtime/instructions.ts`.
