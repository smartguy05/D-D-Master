---
title: Tool engine
area: server
topic: engine
related_code:
  - apps/server/src/engine/**
  - packages/shared/src/tools.ts
  - packages/shared/src/dice.ts
  - packages/shared/src/fog.ts
  - packages/shared/src/effects.ts
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-20: isAttackRoll; AC default; roll source"
  - "2026-10-19: Turn economy gate (engine/economy.ts) in executeEngineTool; take_action"
  - "2026-09-24: Initial version"
  - "2026-09-24: record_physical_roll now emits a roll event for the table toast"
  - "2026-09-24: Fog of war (reveal_area, set_fog, auto-reveal) and board effects in EngineOutcome"
  - "2026-10-18: Map features drive entry, spawn, lit-feature fog reveal and restageForMap"
  - "2026-10-18: Host board tools (engine/board.ts), effective features, fog.hidden"
  - "2026-10-18: Hidden monsters roll initiative; resetForRepaint; expect_name; box sanitizing"
  - "2026-10-18: restageForMap keepFog for a first paint"
  - "2026-10-18: EngineContext gains spell(name), spellCandidates(name) and classData(className) (SRD catalogs)"
  - "2026-10-18: Spawn layout (engine/spawn.ts planSpawn); nearestFreeCell skips blocking features"
  - "2026-10-18: Spawn review: anchor shift, capped arc + ranks, whole-word near, move_token source, restage via planSpawn"
  - "2026-10-18: Arc/line form on a feature's far side when the party is next to it"
  - "2026-10-18: engine/rolls.ts, engine/rules/* registration, cast hook, PC 0-HP rules, pendingRoll.kind, party status rules fields"
  - "2026-10-18: remove_monster turnIndex fix"
  - "2026-10-18: engine/effects.ts: automatic attack/spell effects (attack rolls with target_id, apply_damage source_id, cast_spell)"
  - "2026-10-18: Animation review 2: resolveAttack single-attack fallback guarded (no attack_name, not a spell, damage type match)"
  - "2026-10-18: Animation review 1: resolveAttack returns undefined when nothing names the attack; roller flash fallback"
  - "2026-10-18: add_npc, followers across scenes/restaging, engine/turns.ts (DM-played turn instruction + stalledTurn)"
  - "2026-10-19: move_token redirect note (beside the feature, leave the token there)"
  - "2026-10-19: change_scene applies Location.fog on first arrival"
---

# Tool engine

The engine is pure TypeScript that turns a validated tool call into a new `GameState`.

- `packages/shared/src/tools.ts` — `ToolArgs` (zod schemas), `TOOL_DESCRIPTIONS`, `realtimeToolDefs()`
- `apps/server/src/engine/tools.ts` — `executeEngineTool(state, name, args, ctx)` and one handler per tool
- `apps/server/src/engine/state.ts` — lookup and log helpers (`findCombatant`, `nearestFreeCell`, `blockedCells`, `isCellBlocked`, `addLog`, `addRoll`)
- `apps/server/src/engine/spawn.ts` — `planSpawn` (monster layout for `spawn_monster`) and `findFeature`
- `apps/server/src/engine/ids.ts` — `newId(prefix)` and `cryptoRng`
- `apps/server/src/engine/fog.ts` — `fogEntry`, `revealCells` (skips host-hidden cells unless `explicit`), `hideCells`, `revealAroundCharacters`
- `apps/server/src/engine/board.ts` — host board handlers: `editFog`, `editMapFeature`, `setMonsterHidden`, `clampFeature`
- `apps/server/src/engine/rolls.ts` — `makeRoll` (rolls with `ctx.rng`, logs, stores the roll with its `source`), `rollSummary`, `rollEffects`, `effect`, `isAttackRoll` (a targeted d20 whose label isn't a save/check/contest: AC default, nat 20/1, turn economy)
- `apps/server/src/engine/effects.ts` — automatic attack/spell board effects: `resolveAttack`, `attackOutcome`, `attackRollEffect`, `damageEffect`, `castEffects`, `areaRadiusCells`, `projectileSplit`, `burstKind`. Shared pure helpers `attackStyle`, `elementFor`, `damageTypeOf`, `findAttack` live in `packages/shared/src/effects.ts`
- `apps/server/src/engine/rules/*.ts` — the rules engine (slots, `cast_spell`, rests, `level_up`, death saves, concentration). `rules/index.ts` exports `RULES_TOOLS` (spread into `ENGINE_TOOLS`) and `RULES_HANDLERS` (spread into the handler map). See [rules engine](../gameplay/rules-engine.md)
- `packages/shared/src/fog.ts` — cell keys, circle/rectangle cell sets, visibility (shared with the table)
- `packages/shared/src/dice.ts` — notation parser and roller

## Contract

```ts
executeEngineTool(state, name, rawArgs, ctx) → { state: GameState, outcome: EngineOutcome }
// ctx: { rng, monsterTemplate(name), spell(name), spellCandidates(name), classData(className), locations }
//   spell/classData come from SpellCatalog/ClassCatalog (docs/server/rules-data.md); test stubs return undefined
// outcome: { output (JSON for the model), rolls[], spawned[], sceneChanged?, effects[],
//            cast? (cast_spell: {casterId, spell, castLevel, effect, targetIds, x?, y?}; executeEngineTool turns it into effects via castEffects) }
```

1. `ToolArgs[name].parse(rawArgs)` validates the args and applies defaults. Invalid args throw.
2. The handler runs against a `structuredClone` of the state. The input is never mutated.
3. **Fog auto-reveal**: `revealAroundCharacters` runs after every handler. When fog is enabled for
   the current location, it adds a circle of each character's light radius around its token, plus
   the glow (`LIT_FEATURE_RADIUS` = 2 cells) around the map's `lit` features, skipping cells in
   `fog.hidden` (the host hid them). So a
   move, a scene change (back to a fogged map) or `set_fog enable/reset` all reveal what the party
   sees without extra calls. `ensureCharacterTokens` (new characters) does the same.
4. `version` is incremented.
5. The `output` is small and model-friendly: names, HP strings and dice arrays, with no internal fields.

`GameService.runTool` wraps this. It persists and broadcasts the result, emits `roll` events,
then one `effect` event per `outcome.effects` entry,
generates sprites for newly spawned monsters, and on a scene change refreshes the DM's
instructions and paints the map. The non-engine tools (`lookup_rule`, `consult_brain`,
`confirm_speaker`) are handled in the service.

## Dice notation

`rollNotation("2d20kh1+5")` supports `NdS`, a missing count (`d20`), `d%`, `+`/`-` modifiers,
multiple terms (`1d8+1d6+3`), and keep-highest/lowest (`kh`/`kl`, for advantage and disadvantage).
Dropped dice are returned with `dropped: true`, so the UI can grey them out. Limits: 1–100 dice,
2–1000 sides. The server uses `crypto.randomInt`.

## Behaviour notes

- `request_player_roll` checks the character's `diceMode`:
  - **virtual**: it rolls now and returns the total, and `success` when a `dc` was given.
  - **physical**: it sets `state.pendingRoll` and returns an instruction to ask the player. The
    table shows a banner. The DM (or the host via `/api/rolls/physical`) then calls
    `record_physical_roll`.
- `spawn_monster` looks up the SRD catalog (exact name, then singular, then prefix, then contains).
  It numbers duplicates ("Goblin Warrior 2"); monsters of the same kind share one sprite.
  `hidden: true` creates them with `Monster.hidden` set (an ambush the TV does not show).
- **Spawn layout** (`engine/spawn.ts`, `planSpawn(state, grid, count, opts)`), pure and
  deterministic (no rng). The anchor is the explicit x/y (either part), else the `near` feature
  (`findFeature`: exact, prefix, whole word, contains, case-insensitive; an unknown name throws with the list of
  feature names), else the `focal` feature, else `spawnCell`'s right-middle. A feature anchor is its
  whole footprint, so a blocking altar gets monsters around it. A point anchor (not an exact x and
  y, not a feature) that sits within 2 cells of a PC is first walked away from the party centroid
  until it clears, so the formation is built in one piece. Every cell gets a key compared in
  order: (1) free < free but under a `blocks` feature < has a token, (2) within 2 cells (Chebyshev)
  of a PC — off when an exact x and y are given, the DM chose the spot, (3) misses the `fog`
  preference (`visibilityOf`: `revealed` = the party sees it, `hidden` = it does not; with fog off
  everything is seen), (4) the formation cost, then row and column. The best `count` cells win.
  Formations: **cluster** = nearest to the footprint, leaning to the side facing the party centroid
  (inside a walkable feature, its middle first); **arc** = a front rank about `max(2, ⌈count/2⌉)`
  from the footprint, capped at half the gap to the party centroid and `gap − 3` (min 1), centred
  on the direction of the party; extra monsters form ranks behind it, and cells more than 90° off
  the facing come last, so a big arc never wraps around the party. When the party stands within 3
  cells of a feature anchor (no room for a front rank), arc and line flip to the feature's far side
  (arc radius about ⌈count/4⌉); **line** = a row across that direction, through
  the anchor or the first cell in front of a feature. Without a party the facing is left (the
  default entrance side). A full board reuses blocked, then occupied cells (it never throws).
- **Blocking features**: `nearestFreeCell(state, x, y, w, h, features)` skips cells under
  `blocks` features (the start cell too), falls back to a free blocked cell, then to the clamped
  start on a full board. `move_token` onto an occupied cell goes to the nearest free one (the
  mover's own cell counts as free); from the DM a blocked cell is redirected too. A redirect returns
  `{ redirected: true, reason, note }` ("crate blocks that cell" / "another token is there"). The
  `note` tells the model to leave the token there. When it ends up next to the blocking feature, the
  note also says it can use that feature from where it stands. The host
  (`EngineContext.source = "host"`, set by `GameService.runTool` for REST/Board-tab calls) may drop
  tokens on blocking features. `placeCharacters` and `ensureCharacterTokens` pass the features;
  `restageForMap` places the party at the entrance first, then the monsters with `planSpawn`
  (distance rule, facing the party).
- **Effective features**: `currentGrid` uses `effectiveFeatures(state, loc)`, so the host's
  `featureEdits` (while made for the current `mapUrl`) drive entry, spawn, lit-feature glow and
  restaging. A repaint changes `mapUrl` and the read features apply again.
- **Party placement** (`change_scene`, `ensureCharacterTokens`) starts at the map's `entrance`
  feature, one step in from the board edge (`entryCell`), else the left edge, middle row.
- **`restageForMap(state, ctx)`** (not a tool): after the current location's map is read, it moves
  the party to the entrance and lays the monsters out around the focal feature with `planSpawn`, clears the revealed and hidden cells and
  re-reveals party light + lit features. With `{ keepFog: true }` (a first paint) the explored and
  hidden cells are kept. It returns the same state during combat or with no scene.
  Called by `GameService.generateMap`.
- **`resetForRepaint(state, ctx, locationId)`** (not a tool): drops that location's
  `featureEdits` entry and its explored + hidden fog, then re-lights the party if it is there.
  `generateMap` runs it whenever the map URL changes or the repaint was forced, then restages.
- `start_combat` rolls d20 + DEX mod for each character who is not dead (downed PCs keep a turn
  for their death saves) and d20 + initiative bonus for each
  living monster, **including hidden ones** (an ambusher rolls and acts; only the table hides it).
  It sorts by total, then by the modifier as a tie-break.
- `next_turn` skips monsters at 0 HP and dead PCs, and increments the round when the order wraps.
  On a PC at 0 HP who is not Stable it makes the death save (`engine/rules/vitals.ts`).
- **DM-played turns** (`engine/turns.ts`): `dmCreatureTurn` is the living monster/NPC holding the
  current turn. `start_combat` and `next_turn` then add `instruction` (`dmTurnInstruction`: take the
  whole turn in this reply, then `next_turn`), because the Realtime model tends to announce a
  monster's turn and stop. `stalledTurn(state)` gives `{ key, prompt }` for the session's stall
  nudge (see the Realtime sideband doc); `key` is `round:turnIndex:id`. The instruction also gives
  the monster's movement in feet and its Multiattack count.
- **Turn economy** (`engine/economy.ts`): `executeEngineTool` runs `syncTurn` before and after each
  handler and `economyGate` before it. A DM attack roll, `cast_spell` or `move_token` past the
  current creature's budget returns `{ error, refused: "turn_economy", budget }` without running.
  Otherwise the spend is committed once the handler returned no `error`. `take_action` spends a
  slot directly. `override` skips the check; the host is never checked. See
  [turn economy](../gameplay/turn-economy.md).
- **NPCs** (`add_npc`) are `Monster` entries with `npc: true` (and `ally`, `follows`,
  `appearance`), so damage, initiative, effects and tokens work unchanged. A new NPC stands next to
  the party (`besideParty`: nearest free cell to the PCs' centroid, else the entrance) unless
  x/y/near are given (then `planSpawn`). An outline NPC's description becomes its `appearance`
  (`EngineContext.npcs`). `sharedSprite` never lends a named NPC's portrait to a spawned monster.
- **Followers** (`follows: true`) survive `change_scene` while alive and are placed after the party
  at the entrance (`placeCharacters`); `restageForMap` puts them with the party instead of with the
  monsters.
- **PC damage and healing** follow the SRD 0-HP rules (`damageCharacter`, `afterHealing`):
  Unconscious, massive damage, death-save failures (2 on `critical`), Stable, and a concentration
  save on damage. `add_condition` with an Incapacitating condition ends concentration. Monsters at
  0 HP are simply Dead.
- **Physical rolls**: `pendingRoll.kind` (`check`, `death_save`, `concentration`) tells
  `record_physical_roll` what to apply; it clears only that character's pending roll. Automatic
  requests never overwrite another pending roll (`requestPhysical`).
- `get_party_status` adds each character's rules fields (`rulesStatus`: slots, pact, hit dice,
  concentration, death saves while down, resources).
- `remove_monster` keeps `turnIndex` on the same creature: removing an earlier entry shifts it back
  by one; removing the current one passes the turn to the next (wrapping to 0).
- `change_scene` accepts a location id or name and lists the valid ids when neither matches.
- **Fog**: `change_scene` creates an enabled entry on the first visit to a location with
  `fog: true` (no entry for `fog: false`; an existing entry is never touched, so overrides stick) and
  returns `fog: boolean`. `reveal_area` and `set_fog` work on the current location's `fog` entry
  (created disabled on first use). Revealing while fog is off pre-reveals cells for when it is enabled.
  `get_party_status` adds `fog: { enabled, revealedCells } | null` and marks monsters standing in
  unrevealed cells `unseen: true`. Light is a plain radius: there are no walls yet. `reveal_area`
  is an explicit reveal (un-hides host-hidden cells); `set_fog reset` clears `revealed` and `hidden`.
- **Host board** (`engine/board.ts`): `edit_fog` reveals (explicit) or hides cells; `edit_map_feature`
  adds/updates/deletes/resets the current location's feature edit (clamped to the grid, never
  touching the outline); `set_monster_hidden` toggles `Monster.hidden` (`get_party_status` reports `hidden: true`).
  `edit_map_feature` update/delete accept `expect_name` (refused if the feature at `index` has
  another name), and box numbers are rounded and lifted to x/y ≥ 0, w/h ≥ 1 before validation. `edit_fog` and
  `edit_map_feature` are host-only (see the tool catalog).
- **Effects**: `apply_damage` (amount > 0) pushes a `hit` with `element = damage_type` (plus
  `sourceId`, `style`, `label`, crit `outcome` when `source_id` is given; see `damageEffect`), `heal`
  pushes `heal`. A non-secret roll with a known `target_id` pushes one `attack` effect
  (`attackRollEffect`; also from `record_physical_roll` when the pending check stored a
  `targetId`) instead of the roller flash; other non-secret d20 rolls (including an unknown `target_id`) with a roller push `crit` on a
  natural 20 and `miss` on a natural 1. A successful `cast_spell` sets `outcome.cast` and
  `executeEngineTool` appends `castEffects(cast)`. `play_effect` pushes whatever the DM asks for (it
  resolves names and requires a target or a cell). Effects are never written to the state, and the
  engine has no clock: repeats (orb then attack roll, attack roll then damage) are collapsed on the
  TV (`travelSuppressed`, see [table display](../web/table-display.md#attacks-and-spells-automatic)).

See the [tool catalog](../reference/tool-catalog.md) for every tool's arguments.

## Tests

The rules engine tests are listed in [rules engine](../gameplay/rules-engine.md#tests).
`apps/server/src/engine/tools.test.ts` covers immutability, HP, temp HP and conditions, inventory
stacking and removal, gold, virtual vs physical rolls, SRD spawns, initiative ordering and skipping
the dead, scene changes, and token clamping and stacking. Dice parsing is covered in
`packages/shared/src/dice.test.ts`.
`apps/server/src/engine/economy.test.ts` covers the turn budget: movement and Dash, off-turn
refusals, opportunity attacks, Extra Attack and Multiattack, Action Surge overrides, spell casting
times, failed tools spending nothing, and the host/out-of-combat exemptions.
`apps/server/src/engine/fog.test.ts` covers fog defaults and old saves, `Location.fog` (default
true, first arrival turns fog on, `fog: false` stays clear, a revisit keeps a `set_fog disable`), light-radius reveal on
enable, move and scene change, `reveal_area` circles and rectangles, reset and disable, `unseen`
monsters, and the effects emitted by damage, heal, natural 20/1 and `play_effect`.
`apps/server/src/engine/map-features.test.ts` covers entrance placement, focal spawns, lit-feature
reveal, the no-feature fallbacks and `restageForMap` (and that it skips combat).
`apps/server/src/engine/spawn.test.ts` covers `planSpawn` (no stacking, no blocked cells, the
3-cell distance rule and the exact-x/y exception, cluster/arc/line shapes, the arc facing the party,
`near` by name and the unknown-name error, fog preference and fallback, small-room and fully blocked
boards, hidden spawns, old saves, purity) and `nearestFreeCell` / `move_token` / party placement
around blocking features.
`apps/server/src/engine/board.test.ts` covers `edit_fog` (hide survives auto-reveal and lit
features, explicit reveal un-hides, reset clears, purity), `edit_map_feature` (add/update/delete/
reset, clamping, edits drive spawn/entry/fog, a repaint invalidates them) and `set_monster_hidden`.
`apps/server/src/game/service.board.test.ts` checks the DM is refused host-only tools and host
edits are undoable.
`packages/shared/src/fog.test.ts` covers the cell helpers and the new tool schemas, and
`apps/server/src/engine/effects.test.ts` covers attack effects per tool (style from attack_name,
label, monster description, spells; hit/miss/crit; secret and unknown targets; physical pending
target; old pendingRoll), `apply_damage` with a source (and area spells without travel),
`cast_spell` (Fire Bolt orb, Fireball area at a point or target, Magic Missile darts, Sacred Flame
burst, Cure Wounds heal, Shield arcane, nothing on failure), `areaRadiusCells` and
`projectileSplit`; `packages/shared/src/effects.test.ts` covers `attackStyle`, `elementFor`,
`damageTypeOf`, `findAttack` and the new `BoardEffect` fields.
`apps/server/src/game/service.effects.test.ts` checks that `runTool` broadcasts `effect` events
after `state` and never stores them.
