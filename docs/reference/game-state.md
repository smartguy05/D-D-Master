---
title: GameState and event reference
area: reference
topic: state
related_code:
  - packages/shared/src/schemas.ts
  - packages/shared/src/features.ts
  - packages/shared/src/events.ts
created: 2026-09-24
last_updated: 2026-10-18
last_audited: 2026-10-18
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-09-24: Npc.voice field and npc_speech event"
  - "2026-09-24: Initial version"
  - "2026-09-24: CharacterBuilder"
  - "2026-09-24: Fog of war state, Character.lightRadius, BoardEffect and the effect event"
  - "2026-10-18: Location.features (MapFeature)"
  - "2026-10-18: MapFeature.blocks, GameState.featureEdits, LocationFog.hidden"
  - "2026-10-18: features.ts added to related_code"
  - "2026-10-18: Character rules fields (slots, pact slots, hit dice, death saves, concentration, resources, subclass), pendingRoll.kind"
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
  lightRadius? /* cells, default DEFAULT_LIGHT_RADIUS = 6 (torch) */,
  // rules engine (engine/rules), all defaulted so old saves load:
  subclass: string /* "" */,
  spellSlots: { level 1-9, max, used }[] /* [] */,
  pactSlots?: { level, max, used } /* Warlock Pact Magic */,
  hitDice: { die /* 8 */, max /* 0 = not derived yet */, used /* 0 */ },
  deathSaves: { successes 0-3, failures 0-3, stable } /* zeros, false */,
  concentration: { spell, since /* ms */ } | null /* null */,
  resources: { name, max, used, resetOn: "short"|"long", shortRestRegain?, note? }[] /* [] */ }
```

A character loaded with `hitDice.max === 0` is an old save: `GameService` derives its slots, hit
dice and resources from the SRD class table on load and on every commit (`upgradeCharacters`,
`engine/rules/derive.ts`), without touching values that are set. See
[rules engine](../gameplay/rules-engine.md).

## pendingRoll

```ts
GameState.pendingRoll?: { characterId, notation, label, dc?,
  kind: "check" | "death_save" | "concentration" /* default "check" */ }
```

One slot only. `record_physical_roll` applies the total according to `kind`. Automatic requests
never overwrite another pending roll (the DM is told to record that roll with `kind` instead).

## Outline NPC

```ts
{ name, description, motive, voice }   // voice: accent/pitch/pace/tics direction, default ""
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

## CharacterBuilder (`state.builder?`)

```ts
{ playerId, playerName, level, startedAt, updatedAt,
  draft: Partial<{ name, species, className, subclass, background, abilities: Partial<Abilities>,
    maxHp, ac, speed, skills[], savingThrows[], attacks[], spells[], features[],
    inventory: { name, qty, description? }[], gold, appearance, notes, diceMode }> }
```

## Map features

```ts
Location.features: MapFeature[]  // default []; server-owned, read from the painted map
MapFeature = { name, kind: "entrance"|"exit"|"focal"|"feature" /* default feature */,
               lit: boolean /* default false */, blocks: boolean /* default false; solid furniture,
               pillars, walls */, x, y, w = 1, h = 1 }  // grid cells, x=0 left, y=0 top
GameState.featureEdits: Record<locationId, { mapUrl: string /* default "" */, features: MapFeature[] }>  // default {}
```

`featureEdits` holds the host's fixes from the Board tab. It is in GameState (not the outline) so
edits are undoable. **Always read features through `effectiveFeatures(state, loc)`**: it returns the
edit only while `edit.mapUrl === (loc.mapUrl ?? "")`, else `loc.features`. Repainting a map gives a
new `mapUrl`, so old edits stop applying on their own.

Helpers in `packages/shared/src/features.ts`: `featureFromBox`, `featureCenter`, `entryCell`,
`spawnCell`, `litFeatureCells`, `describeFeatures`, `effectiveFeatures`, `LIT_FEATURE_RADIUS`.

## Fog of war

```ts
GameState.fog: Record<locationId, { enabled: boolean; revealed: string[] /* "x,y" */;
                                    hidden: string[] /* default []: host-hidden cells */ }>  // default {}
```

`hidden` cells are skipped by auto-reveal (party light, lit features) until an explicit reveal
(`reveal_area`, `edit_fog reveal`) un-hides them; `set_fog reset` and a map repaint clear them.

A missing entry means fog is off for that location. Helpers in `packages/shared/src/fog.ts`:
`cellKey`, `cellsInRadius`, `cellsInRect`, `lightRadiusOf`, `activeFog`, `revealedSet`, `visibilityOf`
(both treat hidden cells as unseen).

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
| `npc_speech` | `{ npcName, line, url }`: a `speak_as_npc` clip; `/table` plays `url` (mp3) |
| `effect` | `{ effect: BoardEffect }`: a short visual on the table map (after the matching `state`) |

Schema changes: add new fields with `.default(...)` so saved campaigns still parse.
