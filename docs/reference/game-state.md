---
title: GameState and event reference
area: reference
topic: state
related_code:
  - packages/shared/src/schemas.ts
  - packages/shared/src/events.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version"
  - "2026-09-24: Fog of war state, Character.lightRadius, BoardEffect and the effect event"
---

# GameState and event reference

The authoritative definitions are the zod schemas in `packages/shared/src/schemas.ts`. This page is
a quick reference; [state-model](../architecture/state-model.md) explains the invariants.

## Character

```ts
{ id, playerName, name, species, className, level (1-20), background,
  abilities: { str, dex, con, int, wis, cha },
  maxHp, hp, tempHp, ac, speed, proficiencyBonus,
  skills: string[], savingThrows: string[],
  attacks: { name, toHit?, damage?, description? }[],
  spells: string[], features: string[], conditions: string[],
  inventory: { id, name, qty, description?, equipped? }[],
  gold, notes, appearance, spriteUrl?, diceMode: "virtual"|"physical", color,
  lightRadius? /* cells, default DEFAULT_LIGHT_RADIUS = 6 (torch) */ }
```

## Monster

```ts
{ id, name, srdName?, maxHp, hp, ac, initiativeBonus, abilities?, attacks[], conditions[], cr?, spriteUrl?, hidden }
```

## RollResult

```ts
{ id, notation, label, rollerId?, rollerName, dice: { sides, value, dropped? }[],
  modifier, total, physical, secret, dc?, success?, ts }
```

## Fog of war

```ts
GameState.fog: Record<locationId, { enabled: boolean; revealed: string[] /* "x,y" */ }>  // default {}
```

A missing entry means fog is off for that location. Helpers in `packages/shared/src/fog.ts`:
`cellKey`, `cellsInRadius`, `cellsInRect`, `lightRadiusOf`, `activeFog`, `visibilityOf`.

## BoardEffect

```ts
{ id, kind: hit|crit|miss|heal|slash|fireball|lightning|frost|poison|radiant|necrotic|thunder|arcane,
  targetId?, sourceId?, x?, y?, radius? /* cells */, element? /* damage type */, ts }
```

Transient: broadcast as an event, never stored in `GameState`.

## ServerEvent (`/ws`)

| type | payload |
|---|---|
| `state` | `{ state: GameState }`: the full state after every mutation |
| `campaign` | `{ campaign: Campaign \| null }` |
| `roll` | `{ roll: RollResult }`: for animations (it is also in `state.rolls`) |
| `speaker` | `{ speaker: ActiveSpeaker \| null }`: `{ playerId, playerName, characterName?, confidence, ts }` |
| `dm_status` | `{ status: offline\|connecting\|listening\|thinking\|speaking, mode: voice\|text\|none }` |
| `job` | `{ id, label, status: running\|done\|error, detail? }` |
| `enroll` | `{ playerId, ok, samples, message }` |
| `error` | `{ message }` |
| `effect` | `{ effect: BoardEffect }`: a short visual on the table map (after the matching `state`) |

Schema changes: add new fields with `.default(...)` so saved campaigns still parse.
