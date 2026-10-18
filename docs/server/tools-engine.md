---
title: Tool engine
area: server
topic: engine
related_code:
  - apps/server/src/engine/**
  - packages/shared/src/tools.ts
  - packages/shared/src/dice.ts
  - packages/shared/src/fog.ts
created: 2026-09-24
last_updated: 2026-10-18
last_audited: 2026-10-18
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-09-24: Initial version"
  - "2026-09-24: record_physical_roll now emits a roll event for the table toast"
  - "2026-09-24: Fog of war (reveal_area, set_fog, auto-reveal) and board effects in EngineOutcome"
  - "2026-10-18: Map features drive entry, spawn, lit-feature fog reveal and restageForMap"
  - "2026-10-18: Host board tools (engine/board.ts), effective features, fog.hidden"
  - "2026-10-18: Hidden monsters roll initiative; resetForRepaint; expect_name; box sanitizing"
  - "2026-10-18: restageForMap keepFog for a first paint"
  - "2026-10-18: Spawn layout (engine/spawn.ts planSpawn); nearestFreeCell skips blocking features"
  - "2026-10-18: Spawn review: anchor shift, capped arc + ranks, whole-word near, move_token source, restage via planSpawn"
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
- `packages/shared/src/fog.ts` — cell keys, circle/rectangle cell sets, visibility (shared with the table)
- `packages/shared/src/dice.ts` — notation parser and roller

## Contract

```ts
executeEngineTool(state, name, rawArgs, ctx) → { state: GameState, outcome: EngineOutcome }
// ctx: { rng, monsterTemplate(name), locations }
// outcome: { output (JSON for the model), rolls[], spawned[], sceneChanged?, effects[] }
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
  the facing come last, so a big arc never wraps around the party; **line** = a row across that direction, through
  the anchor or the first cell in front of a feature. Without a party the facing is left (the
  default entrance side). A full board reuses blocked, then occupied cells (it never throws).
- **Blocking features**: `nearestFreeCell(state, x, y, w, h, features)` skips cells under
  `blocks` features (the start cell too), falls back to a free blocked cell, then to the clamped
  start on a full board. `move_token` onto an occupied cell goes to the nearest free one (the
  mover's own cell counts as free); from the DM a blocked cell is redirected too. A redirect returns
  `{ redirected: true, reason }` ("crate blocks that cell" / "another token is there"). The host
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
- `start_combat` rolls d20 + DEX mod for each living character and d20 + initiative bonus for each
  living monster, **including hidden ones** (an ambusher rolls and acts; only the table hides it).
  It sorts by total, then by the modifier as a tie-break.
- `next_turn` skips monsters at 0 HP and increments the round when the order wraps.
- `change_scene` accepts a location id or name and lists the valid ids when neither matches.
- **Fog**: `reveal_area` and `set_fog` work on the current location's `fog` entry (created
  disabled on first use). Revealing while fog is off pre-reveals cells for when it is enabled.
  `get_party_status` adds `fog: { enabled, revealedCells } | null` and marks monsters standing in
  unrevealed cells `unseen: true`. Light is a plain radius: there are no walls yet. `reveal_area`
  is an explicit reveal (un-hides host-hidden cells); `set_fog reset` clears `revealed` and `hidden`.
- **Host board** (`engine/board.ts`): `edit_fog` reveals (explicit) or hides cells; `edit_map_feature`
  adds/updates/deletes/resets the current location's feature edit (clamped to the grid, never
  touching the outline); `set_monster_hidden` toggles `Monster.hidden` (`get_party_status` reports `hidden: true`).
  `edit_map_feature` update/delete accept `expect_name` (refused if the feature at `index` has
  another name), and box numbers are rounded and lifted to x/y ≥ 0, w/h ≥ 1 before validation. `edit_fog` and
  `edit_map_feature` are host-only (see the tool catalog).
- **Effects**: `apply_damage` (amount > 0) pushes a `hit` with `element = damage_type`, `heal` pushes
  `heal`, a non-secret d20 roll with a roller pushes `crit` on a natural 20 and `miss` on a natural 1,
  and `play_effect` pushes whatever the DM asks for (it resolves names and requires a target or a
  cell). Effects are never written to the state.

See the [tool catalog](../reference/tool-catalog.md) for every tool's arguments.

## Tests

`apps/server/src/engine/tools.test.ts` covers immutability, HP, temp HP and conditions, inventory
stacking and removal, gold, virtual vs physical rolls, SRD spawns, initiative ordering and skipping
the dead, scene changes, and token clamping and stacking. Dice parsing is covered in
`packages/shared/src/dice.test.ts`.
`apps/server/src/engine/fog.test.ts` covers fog defaults and old saves, light-radius reveal on
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
`apps/server/src/game/service.effects.test.ts` checks that `runTool` broadcasts `effect` events
after `state` and never stores them.
