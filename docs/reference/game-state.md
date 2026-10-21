---
title: GameState and event reference
area: reference
topic: state
related_code:
  - packages/shared/src/scenes.ts
  - packages/shared/src/attitude.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/features.ts
  - packages/shared/src/events.ts
  - packages/shared/src/los.ts
  - packages/shared/src/index.ts
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-20: ai_player event; npc_speech carries AI player lines"
  - "2026-10-20: GameState.scenes (SceneStash), GameState.partyLocations, PendingRoll schema (party split)"
  - "2026-10-20: Campaign.deathRule"
  - "2026-10-20: MomentKind combat_start"
  - "2026-10-20: Character.rosterId and RosterEntry"
  - "2026-10-20: Monster.voice default is defaultNpcVoice(name)"
  - "2026-10-20: Monster attitude/attitudeScore/voice; attitude moment; attitude.ts helpers"
  - "2026-10-20: MapObject, GameState.mapObjects, Item.iconUrl, MapFeature.interactive (FeatureBox.interactive, describeFeatures tag), pickup event"
  - "2026-10-20: Combat.announced, Moment, moment event, Campaign.status/completedAt"
  - "2026-10-20: Review fixes: WallEdit.host, walls server-owned in mergeOutline, narrow doors kept as one unit edge"
  - "2026-10-20: Walls and doors: Location.walls, GameState.wallEdits, effectiveWalls, wallsFromLines, RollResult.cover"
  - "2026-10-20: pendingRoll.critical"
  - "2026-10-20: PendingRollKind damage"
  - "2026-10-20: conditionMeta, deathSaves.lastRolled, Monster combatant/neutral"
  - "2026-10-20: TurnBudget.spellAttacks/spellAttackSpell, RollResult.source"
  - "2026-10-19: Combat turn budget (turn, reactionsUsed); Monster speed and attacksPerAction"
  - "2026-10-19: change_scene creates the fog entry from Location.fog"
  - "2026-10-19: mic event"
  - "2026-10-19: npc_focus and caption events"
  - "2026-10-19: talk event"
  - "2026-09-24: Npc.voice field and npc_speech event"
  - "2026-09-24: Initial version"
  - "2026-09-24: CharacterBuilder"
  - "2026-09-24: Fog of war state, Character.lightRadius, BoardEffect and the effect event"
  - "2026-10-18: Location.features (MapFeature)"
  - "2026-10-18: MapFeature.blocks, GameState.featureEdits, LocationFog.hidden"
  - "2026-10-18: features.ts added to related_code"
  - "2026-10-18: Character rules fields (slots, pact slots, hit dice, death saves, concentration, resources, subclass), pendingRoll.kind"
  - "2026-10-18: Character.slotTurn"
  - "2026-10-18: BoardEffect attack/area kinds, style, outcome, label, count, shape; pendingRoll targetId/attackName"
  - "2026-10-18: Monster npc, appearance, ally, follows"
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
  conditionMeta: { name, casterId?, spell?, until?: { kind: "concentration"|"rounds"|"end_of_turn", round?, entityId? } }[] /* default [] */,
  inventory: { id, name, qty, description?, equipped?, iconUrl? /* generated item icon */ }[],
  gold, notes, appearance, spriteUrl?, diceMode: "virtual"|"physical", color,
  lightRadius? /* cells, default DEFAULT_LIGHT_RADIUS = 6 (torch) */,
  // rules engine (engine/rules), all defaulted so old saves load:
  subclass: string /* "" */,
  spellSlots: { level 1-9, max, used }[] /* [] */,
  pactSlots?: { level, max, used } /* Warlock Pact Magic */,
  hitDice: { die /* 8 */, max /* 0 = not derived yet */, used /* 0 */ },
  deathSaves: { successes 0-3, failures 0-3, stable, lastRolled: {round, entityId} | null } /* zeros, false, null */,
  concentration: { spell, since /* ms */ } | null /* null */,
  resources: { name, max, used, resetOn: "short"|"long", shortRestRegain?, note? }[] /* [] */,
  slotTurn?: { round, turn } /* combat turn of the last spell slot spent (one-slot-per-turn warning) */,
  rosterId?: string /* link to the global character roster (ros_…); unset until saved there */ }
```

`RosterEntry` (not in `GameState`; `GET /api/roster`, see [character roster](../gameplay/character-roster.md)):

```ts
{ id, name, playerName /* "" */, className /* "" */, subclass /* "" */, level /* 1, int 1-20 */,
  species /* "" */, spriteUrl? /* /media/roster/<id>.png */, hasVoiceprint /* false */, updatedAt,
  campaignsPlayed? }
```

A character loaded with `hitDice.max === 0` is an old save: `GameService` derives its slots, hit
dice and resources from the SRD class table on load and on every commit (`upgradeCharacters`,
`engine/rules/derive.ts`), without touching values that are set. See
[rules engine](../gameplay/rules-engine.md).

## pendingRoll

```ts
GameState.pendingRoll?: { characterId, notation, label, dc?,
  kind: "check" | "death_save" | "concentration" | "damage" /* default "check" */,
  critical?: boolean /* damage after a critical hit */,
  targetId?, attackName? /* attack rolls: animated when the total is recorded */ }
```

One slot only. `record_physical_roll` applies the total according to `kind`. Automatic requests
never overwrite another pending roll (the DM is told to record that roll with `kind` instead).

## Outline NPC

```ts
{ name, description, motive, voice }   // voice: accent/pitch/pace/tics direction, default ""
```

## Monster

```ts
{ id, name, srdName?, maxHp, hp, ac, initiativeBonus,
  speed /* default 30: SRD walking Speed, ft */, attacksPerAction /* default 1: Multiattack */, abilities?, attacks[], conditions[], cr?, spriteUrl?, hidden,
  npc /* default false: a named NPC from add_npc, own portrait */, appearance /* default "" */,
  ally /* default false: on the party's side */, follows /* default false: travels with the party */,
  combatant /* default true: rolls initiative; add_npc NPCs default false */, neutral /* default false: neither side, out of combat */,
  conditionMeta /* default [], as on Character */,
  attitude? /* "hostile" | "indifferent" | "friendly"; unset on old saves: derived (attitudeOf) */,
  attitudeScore? /* int -5..5: <= -3 hostile, -2..+2 indifferent, >= +3 friendly */,
  voice? /* speak_as_npc voice direction (add_npc voice or defaultNpcVoice(name)) */ }
```

## Combat

```ts
GameState.combat: { active, round, turnIndex, order: { entityId, entityType, name, initiative }[],
  turn: { entityId, round, speed, movementUsed, extraMovement, action, bonusAction,
          attacksUsed, attacksPerAction, disengaged, dodging,
          spellAttacks /* 0 */, spellAttackSpell /* "" */ } | null /* default null */,
  reactionsUsed: string[] /* default []: reactions spent since each creature's last turn */,
  announced: ("victory" | "defeat")[] /* default []: banners already shown this combat (once-per-combat guard) */ }
```

`turn` is the current creature's budget, kept in step by `syncTurn` on every engine tool. See
[turn economy](../gameplay/turn-economy.md).

## RollResult

```ts
{ id, notation, label, rollerId?, rollerName, dice: { sides, value, dropped? }[],
  modifier, total, physical, secret, dc?, success?, source /* "dm" | "host", default "dm" */, attack /* default false: an attack roll at a creature */, targetId? /* its target */, ts }
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
               pillars, walls */, interactive: boolean /* default false; usable things: levers,
               chests, altars, doors — the TV draws an aura, the DM uses them from beside them */,
               x, y, w = 1, h = 1 }  // grid cells, x=0 left, y=0 top
GameState.featureEdits: Record<locationId, { mapUrl: string /* default "" */, features: MapFeature[] }>  // default {}
```

`featureEdits` holds the host's fixes from the Board tab. It is in GameState (not the outline) so
edits are undoable. **Always read features through `effectiveFeatures(state, loc)`**: it returns the
edit only while `edit.mapUrl === (loc.mapUrl ?? "")`, else `loc.features`. Repainting a map gives a
new `mapUrl`, so old edits stop applying on their own.

Helpers in `packages/shared/src/features.ts`: `featureFromBox`, `featureCenter`, `entryCell`,
`spawnCell`, `litFeatureCells` (the glow stops at sight-blocking walls), `describeFeatures`,
`effectiveFeatures`, `effectiveWalls`, `wallsFromLines`, `LIT_FEATURE_RADIUS`.

## Map objects (loot and interactables)

```ts
GameState.mapObjects: MapObject[]  // default []; every location, filter by locationId
MapObject = { id, locationId, kind: "loot"|"interactable", name, x, y /* one cell */,
              items: Item[] /* default [] */, gold /* >= 0, default 0 */,
              iconUrl? /* board marker: the loot sack for loot */,
              discovered /* default true */, used /* default false */, hidden /* default false */ }
```

Created by `drop_loot` (loot) and `place_interactable`; changed by `pick_up`, `set_interactable`,
`remove_map_object` (see the [tool catalog](tool-catalog.md)). Empty loot is removed by `pick_up`;
interactables stay. Hidden objects are known to the DM and host only. Item and loot-sack icons are
filled in the background after a drop ([images](../server/images.md)).

## Party split

```ts
GameState.scenes: Record<locationId, SceneStash>   // default {}; groups the TV isn't showing
SceneStash = { tokens: Token[], monsters: Monster[], combat: Combat /* frozen */, pendingRoll?: PendingRoll }
GameState.partyLocations: Record<characterId, locationId>  // default {}; only PCs away from the focus
```

`locationId`, `tokens`, `monsters`, `combat` and `pendingRoll` are always the scene **in focus**.
Read helpers (`locationOfCharacter`, `sceneView`, `partyGroups`, `allMonsters`) are in
`packages/shared/src/scenes.ts`. See [party split](../gameplay/party-split.md).

## Walls and doors

```ts
Location.walls: WallSeg[]  // default []; read from the painted map with the features
WallSeg = { id, x1, y1, x2, y2 /* grid intersections, 0..gridW / 0..gridH, axis-aligned */,
            kind: "wall"|"door"|"window" /* default wall */, open: boolean /* default false; doors only */ }
GameState.wallEdits: Record<locationId, { walls: WallSeg[], host: boolean /* default true */ }>  // default {}
RollResult.cover?: "half"|"three-quarters"   // optional (old saves load); pendingRoll.cover too
```

A wall blocks sight and movement, a closed door both, an open door neither, a window movement only
(`blocksSight`/`blocksMove` in `packages/shared/src/los.ts`). **Read walls through
`effectiveWalls(state, loc)`**: the `wallEdits` entry when there is one, else `loc.walls`. Unlike
`featureEdits` there is no `mapUrl` gate, so host fixes survive a repaint of the same location
until the host resets them (`edit_walls reset`). `set_door` and `edit_walls` copy the walls into
`wallEdits` on first change; `edit_walls` sets `host: true`, while an edit only `set_door` wrote
has `host: false` (door states only) and a repaint drops it. `Location.walls` is server-owned:
`mergeOutline` ignores the client's copy. Ids are `w1…` (walls), `d1…` (doors), `win1…`
(windows) from `wallsFromLines`, which snaps the vision model's polylines (image fractions) to grid
intersections and turns diagonal legs into staircases of unit edges. A door that snaps to a single
point becomes the unit edge under its midpoint, and a door or window removes the wall under it.

## Fog of war

```ts
GameState.fog: Record<locationId, { enabled: boolean; revealed: string[] /* "x,y" */;
                                    hidden: string[] /* default []: host-hidden cells */ }>  // default {}
```

`hidden` cells are skipped by auto-reveal (party light, lit features) until an explicit reveal
(`reveal_area`, `edit_fog reveal`) un-hides them; `set_fog reset` and a map repaint clear them.

A missing entry means fog is off for that location. `change_scene` creates an enabled entry on the
first visit to a location with `Location.fog` true (default true); later visits keep the entry as
it is, so a `set_fog` override sticks. Helpers in `packages/shared/src/fog.ts`:
`cellKey`, `cellsInRadius`, `cellsInRect`, `lightRadiusOf`, `activeFog`, `revealedSet`, `visibilityOf`
(both treat hidden cells as unseen).

## BoardEffect

```ts
{ id, kind: hit|crit|miss|heal|slash|fireball|lightning|frost|poison|radiant|necrotic|thunder|arcane
        |attack /* travel source→target, then outcome */|area /* ring of radius */,
  targetId?, sourceId?, x?, y?, radius? /* cells */, element? /* damage type */,
  style?: melee|ranged|spell|area, outcome?: hit|miss|crit, label? /* attack or spell name */,
  count? /* darts 1-6 */, shape? /* area shape */, ts }
```

Transient: broadcast as an event, never stored in `GameState`. The new fields are optional, so older
effects (and clients) still parse. See [table display](../web/table-display.md#attacks-and-spells-automatic).

## ServerEvent (`/ws`)

| type | payload |
|---|---|
| `state` | `{ state: GameState }`: the full state after every mutation |
| `campaign` | `{ campaign: Campaign \| null }` |
| `roll` | `{ roll: RollResult }`: for animations (it is also in `state.rolls`) |
| `speaker` | `{ speaker: ActiveSpeaker \| null }`: `{ playerId, playerName, characterName?, confidence, ts }` |
| `dm_status` | `{ status: offline\|connecting\|listening\|thinking\|speaking, mode: voice\|text\|none }` |
| `mic` | `{ muted, by? }`: table mic hard mute (`by` = the player who toggled it from a phone). Repeated on connect. Not persisted |
| `job` | `{ id, label, status: running\|done\|error, detail? }` |
| `enroll` | `{ playerId, ok, samples, message }` |
| `error` | `{ message }` |
| `npc_speech` | `{ npcName, line, url }`: a `speak_as_npc` clip or an AI player's line (`npcName` = its character); `/table` plays `url` (mp3) |
| `ai_player` | `{ playerId, status: idle\|thinking\|speaking, line? }`: an [AI player's](../gameplay/ai-players.md) status for `/host`. Not persisted |
| `npc_focus` | `{ focus: { name, portraitUrl? } \| null }`: the NPC the DM is voicing (TV close-up). Repeated on connect. Not persisted |
| `caption` | `{ caption: { id, npcName, text, final } }`: the focused NPC's words (the DM's transcript: pieces, then the whole reply as final). Not persisted |
| `talk` | `{ talk: { who: "player", active, level?, playerId?, provisional? } }`: someone is talking right now (live, ~8/s while they speak; see `docs/server/speaker-id.md`). Not persisted |
| `effect` | `{ effect: BoardEffect }`: a short visual on the table map (after the matching `state`) |
| `moment` | `{ moment: Moment }`: a table moment for the TV overlay (after the matching `state` and `effect`s). Not persisted and not in the connect snapshot |
| `pickup` | `{ pickup: { characterId, characterName, items: { name, qty, iconUrl? }[], gold } }`: a `pick_up` for the TV toast (after the matching `state`). Not persisted and not in the connect snapshot |

## Moment

```ts
Moment: { id, kind: "victory" | "defeat" | "fled" | "death" | "revived" | "campaign_end" | "turn_start" | "attitude" | "combat_start",
  targetId?, outcome?: "monster" | "rallied" | "success" | "failure" | "hostile" | "indifferent" | "friendly", text? /* campaign_end epilogue */, ts }
```

`death` + `monster`: a foe killed; `revived` + `rallied`: a PC back up from 0 HP (a real revival
has no outcome); `campaign_end` + `success`/`failure`; `attitude` + the new attitude (targetId =
the creature, from `adjust_attitude` crossing a threshold). Built by `engine/moments.ts`, never stored.

## Campaign status

`Campaign.status`: `active` (default, so old saves load) \| `completed` \| `failed`, set by
`end_campaign` with `completedAt` (ms). `resetCampaign` sets it back to `active` and clears
`completedAt`; bundles keep both.

`Campaign.deathRule`: `party_wipe` (default, so old saves load) \| `any_death`. When character
deaths end the campaign in failure on their own: once every PC is `Dead`, or on the first PC death.
See [tool catalog: death rule](tool-catalog.md#death-rule-automatic-campaign-failure).

Schema changes: add new fields with `.default(...)` so saved campaigns still parse.
