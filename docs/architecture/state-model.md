---
title: State model
area: architecture
topic: state
related_code:
  - packages/shared/src/schemas.ts
  - apps/server/src/engine/state.ts
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude
status: current
change_log:
  - "2026-10-20: Location.walls"
  - "2026-10-19: combat.turn and reactionsUsed (turn economy)"
  - "2026-10-18: Location.features"
  - "2026-10-18: Tokens avoid blocking features"
  - "2026-09-24: Outline editing, undo version rule, state_history"
  - "2026-09-24: Initial version"
  - "2026-09-24: state.builder"
  - "2026-10-18: Character rules fields and pendingRoll.kind"
  - "2026-10-18: NPCs live in monsters[] (npc/ally/follows)"
  - "2026-10-19: Location.fog"
---

# State model

All shapes are Zod schemas in `packages/shared/src/schemas.ts`. Types are inferred from those
schemas, so the server and web always agree. There are two top-level documents per campaign:

## `Campaign` (slow-changing, authored)

- `id`, `name`, `premise`, `partyLevel`, `createdAt`, `updatedAt`
- `outline?`: `title`, `hook`, `acts[]`, `locations[]`, `npcs[]`, `encounters[]`. The brain writes
  it; the host can rewrite it or edit it by hand (`PUT /api/campaign/outline`, which keeps each
  `mapUrl` unless that location's `mapPrompt` changed).
  - `Location`: `id` (`loc_*`), `name`, `description`, `mapPrompt`, `mapUrl?`, `features`
    (landmarks read from the painted map, server-owned; see `docs/reference/game-state.md`), `walls`
    (wall, door and window segments on grid lines, read from the map; default `[]`), `gridW`, `gridH`, `fog` (default true:
    fog of war turns on at the first visit; false for shops, inns and other lit places)
    (5-ft squares)
  - `Encounter`: `locationId`, `description`, `monsters[{name,count}]` (SRD names)
- `sessionSummaries[]`: one "previously on…" recap per ended session

## `GameState` (fast-changing, authoritative)

| Field | Meaning |
|---|---|
| `campaignId`, `locationId?` | Which map is shown |
| `players[]` | People at the table: `id`, `name`, `characterId?`, and `voiceSamples` (0 = voice not enrolled) |
| `characters[]` | Player characters: stats, `hp/maxHp/tempHp`, `ac`, `conditions`, `inventory`, `gold`, `attacks`, `diceMode` (`virtual`/`physical`), `spriteUrl`, `color`, and rules state: `subclass`, `spellSlots`, `pactSlots?`, `hitDice`, `deathSaves`, `concentration`, `resources` (derived from the SRD class table, see [rules engine](../gameplay/rules-engine.md)) |
| `monsters[]` | Monsters in the scene, filled from SRD stat blocks when names match. Named NPCs on the map (`add_npc`) live here too, with `npc`, `ally` and `follows` |
| `tokens[]` | Grid positions: `entityId`, `entityType`, `x`, `y`, `size` |
| `combat` | `active`, `round`, `turnIndex`, `order[]` (initiative entries), `turn` (the current creature's [turn budget](../gameplay/turn-economy.md)) and `reactionsUsed[]` |
| `rolls[]` | The last 30 `RollResult`s (dice, modifier, total, dc/success, physical, secret) |
| `log[]` | The last 300 log lines (`dm`, `player`, `system`, `roll`, `tool`) |
| `pendingRoll?` | A physical-dice roll the DM is waiting on; `kind` = `check`, `death_save` or `concentration` (what `record_physical_roll` does with the total) |
| `activeSpeaker?` | The last identified speaker (transient; not relied on after reload) |
| `builder?` | The voice character builder in progress: `playerId`, `playerName`, `level`, `draft` (a partial `BuilderDraft`), `startedAt`, `updatedAt` |
| `version` | Incremented on every mutation. An undo/restore commits the old snapshot with `version` = current + 1, so it never goes backwards |

## Invariants

- **Engine tools never mutate their input.** `executeEngineTool` clones the state, applies the
  handler, and bumps `version`. The service then commits the result.
- **HP is clamped to `[0, maxHp]`.** Temp HP absorbs damage first. At 0 HP a character gains
  *Unconscious* and a monster gains *Dead*. Healing above 0 removes those conditions. A PC also
  follows the SRD death-save and massive-damage rules (`engine/rules/vitals.ts`).
- **Tokens never stack.** `nearestFreeCell` spirals outward from the requested cell, skipping
  cells under `blocks` features (furniture, pillars). Moves are clamped to the current location's
  grid. Monster spawns use `planSpawn` (see the tool engine doc).
- **Names are resolved as well as ids.** `findCombatant` accepts an id, an exact name, a player name,
  or a name prefix, because models sometimes pass names instead of ids.
- **Changing scene** clears monsters and combat, then places the party near the left-middle of the
  new grid.

## Persistence

`Store` (`apps/server/src/db/index.ts`) keeps the campaign and state as JSON blobs, plus an
append-only `events` table (logs and tool calls), `voiceprints`, and `state_history` (the last 50
pre-change snapshots for undo; see [history and bundles](../server/history-and-bundles.md)). See
[persistence](../server/persistence.md).
