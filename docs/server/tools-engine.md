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
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version"
  - "2026-09-24: record_physical_roll now emits a roll event for the table toast"
  - "2026-09-24: Fog of war (reveal_area, set_fog, auto-reveal) and board effects in EngineOutcome"
---

# Tool engine

The engine is pure TypeScript that turns a validated tool call into a new `GameState`.

- `packages/shared/src/tools.ts` — `ToolArgs` (zod schemas), `TOOL_DESCRIPTIONS`, `realtimeToolDefs()`
- `apps/server/src/engine/tools.ts` — `executeEngineTool(state, name, args, ctx)` and one handler per tool
- `apps/server/src/engine/state.ts` — lookup and log helpers (`findCombatant`, `nearestFreeCell`, `addLog`, `addRoll`)
- `apps/server/src/engine/ids.ts` — `newId(prefix)` and `cryptoRng`
- `apps/server/src/engine/fog.ts` — `fogEntry`, `revealCells`, `revealAroundCharacters`
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
   the current location, it adds a circle of each character's light radius around its token. So a
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
  It numbers duplicates ("Goblin Warrior 2") and places them on free cells near the right-middle or
  the requested cell. Monsters of the same kind share one sprite.
- `start_combat` rolls d20 + DEX mod for each living character and d20 + initiative bonus for each
  visible living monster. It sorts by total, then by the modifier as a tie-break.
- `next_turn` skips monsters at 0 HP and increments the round when the order wraps.
- `change_scene` accepts a location id or name and lists the valid ids when neither matches.
- **Fog**: `reveal_area` and `set_fog` work on the current location's `fog` entry (created
  disabled on first use). Revealing while fog is off pre-reveals cells for when it is enabled.
  `get_party_status` adds `fog: { enabled, revealedCells } | null` and marks monsters standing in
  unrevealed cells `unseen: true`. Light is a plain radius: there are no walls yet.
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
`packages/shared/src/fog.test.ts` covers the cell helpers and the new tool schemas, and
`apps/server/src/game/service.effects.test.ts` checks that `runTool` broadcasts `effect` events
after `state` and never stores them.
