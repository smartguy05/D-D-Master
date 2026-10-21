---
title: Party split
area: gameplay
topic: party-split
related_code:
  - packages/shared/src/scenes.ts
  - apps/server/src/engine/scenes.ts
  - apps/server/src/engine/tools.ts
  - apps/web/src/host/PartySpotlight.tsx
  - apps/web/src/host/partyGroups.ts
  - apps/web/src/table/otherGroups.ts
  - apps/web/src/player/PlayerMap.tsx
  - apps/web/src/player/playerMap.ts
created: 2026-10-20
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Ready check (departureGate) with split groups: focus movers only, regroup is not leaving, TTL/input window, forced"
  - "2026-10-21: Audit: phone map auras drawn with one style"
  - "2026-10-20: Created: change_scene character_ids, focus_scene, parked scenes, frozen fights, host spotlight card, TV other-groups line, phone map"
---

# Party split

The party can split into groups at different locations. The TV shows one group at a time, called
the **scene in focus**. The DM (or the host) cuts between groups. Each group has its own fight, and a
fight that is not in focus is frozen until the DM cuts back. Every phone shows a map of its
character's own location.

## Table flow

1. "Thorin and Lyra go down the stairs": the DM calls `change_scene {location_id, character_ids}`.
   The movers' location becomes the scene in focus, so the TV follows them. Bram stays behind in his
   own scene with whatever was there.
2. The DM plays everyone in the scene in focus, then calls `focus_scene {location_id}` to cut to
   Bram. In combat the persona tells the DM to finish the round before cutting away.
3. A fight the DM cuts away from **freezes**: its round, turn order, current turn, turn budget,
   reactions and any pending physical roll are kept. Focusing back resumes it, and the TV shows the
   turn banner (`turn_start`) for whoever holds the turn.
4. When a group reaches the other group's location (`change_scene` with their `character_ids`), the
   groups merge: the newcomers stand by the entrance and roll into a running fight. `change_scene`
   without `character_ids` gathers the whole party at one place.

The host can do all of this from **Party & spotlight** (see below).

## Data model: swap on focus

The scene in focus is always the top-level state:

- `GameState.locationId`
- `tokens`
- `monsters`
- `combat`
- `pendingRoll`

As a result, the engine, the TV's `MapBoard` and every helper written for "the current scene" work
unchanged.

The other groups are stored in two places:

| Field | Meaning |
|---|---|
| `GameState.scenes[locationId]` | `SceneStash {tokens, monsters, combat, pendingRoll?}`: a group's parked scene |
| `GameState.partyLocations[characterId]` | the location of a PC **away** from the focus (PCs in focus have no entry) |

Both default to `{}`, so a party that has never split, and an old save, look exactly as before.

The invariants are enforced by `pruneScenes`, and on every commit by `normalizeScenes`:
- no `partyLocations` entry for the focus, for a removed PC, or for a location with no stash;
- no parked scene without a PC. When the last PC leaves a place, the monsters left there are gone,
  as before the split.

### Read helpers (`packages/shared/src/scenes.ts`)

- `locationOfCharacter`, `isAway`, `presentCharacters` and `charactersAt`.
- `isSplit`.
- `sceneView(state, loc)`: the top level for the focus, otherwise the stash.
- `sceneState(state, loc)`: the state as if `loc` were in focus, used by read-only helpers such as
  `monsterShownOnTable` and `activeFog`.
- `partyGroups(state, locations)`: the focused group first, then each other group with its frozen
  fight.
- `allMonsters`: the live objects from every scene. Sprite writes and history labels use it.

### Engine (`apps/server/src/engine/scenes.ts`)

- `focusScene(state, loc)` parks the focus and loads `loc`, then prunes.
- `inScene(state, loc, fn)` runs focused-scene code (for example `leaveInitiative`) on a parked
  scene, then swaps back.
- `mapScene(state, loc, fn)` is the immutable version. `stateAfterPaint` uses it so that a parked
  location that finishes painting is restaged and its fog redrawn.
- `forgetCharacter` cleans up after `removeCharacter`.

## Tools

The full argument tables are in `docs/reference/tool-catalog.md`.

- **`change_scene {location_id, character_ids?}`.** Without ids and with the party together, it
  behaves as it always did. With ids, `moveGroup` (in `engine/tools.ts`) does the following:
  - It resolves PCs from any scene, plus listed companion NPCs.
  - It refuses PCs who are already at the destination.
  - It takes the movers out of their origin's initiative and removes their tokens.
  - An origin whose last PC left takes its followers along and is dropped.
  - The destination becomes the focus. A fresh destination gets an empty combat and the first-visit
    fog rule. An existing one (another group's) is merged into: arrivals are placed by the entrance
    with `nearestFreeCell` and roll initiative with `joinInitiative` (a PC's roll uses their Dex
    modifier).
  - It returns `arrived`, `here`, `joined_initiative`, `left_behind` (a frozen-fight note),
    `other_groups` and `instruction`.

  Without ids while the party is split, every PC moves there (a regroup).
- **Ready check before a DM `change_scene`.** `departureGate` (`game/readyCheck.ts`) runs before
  the tool and is aware of splits:
  - Only the human players whose characters would leave the scene **in focus** are asked. With
    `character_ids`, that is the listed movers. AI-only groups skip the check.
  - Travelling to the location the party is already at is not leaving. A split group regrouping
    onto the focus goes straight through.
  - The first call is refused with an `error` and an `ask` list of names. A repeat to the same
    place from the same place goes through once a human has spoken since, within
    `READY_CHECK_MAX_AGE_MS` (5 min) and `READY_CHECK_MAX_INPUTS` (8 human lines). A stale check is
    asked again.
  - The pending check is cleared on any party move, on load and on a new DM session.
  - `forced: true` (a trapdoor, a teleport) skips the check, and so does an unknown location (the
    engine reports that one).
  - Host calls are not gated. Details are in [AI players](ai-players.md)
    (bugs/ready-check-stale-pending, bugs/ready-check-late-yes).
- **`focus_scene {location_id}`.**
  - It is a no-op ("Already in focus.") on the focus.
  - It returns `{error}` when no PC is at the location.
  - Otherwise it switches the focus and sets `sceneChanged`, so the map paints and the DM's
    instructions refresh.
  - It pushes `turn_start` when the scene it cuts to has a fight.
  - It returns `left_behind` and an `instruction` to resume the fight or to pick up with the group.
  - When the host calls it, the DM gets the note "Host moved the spotlight to …"
    (`game/hostNote.ts`), not the monster diff.

### What only the scene in focus does

The guard is `awayRefusal` in `executeEngineTool`, which runs before the turn-economy gate. While the
party is split it refuses the following when they name an away PC:
- `move_token`, `take_action` and `pick_up`;
- `cast_spell` (as caster or target);
- `roll_dice` and `request_player_roll` when they carry a `target_id`.

The error says: "X is at Y … Call focus_scene <id> first".

Upkeep tools still work for away PCs: `heal`, `give_item`, gold, conditions, rests, `level_up` and
resources.

These rules count only the PCs in focus:
- `start_combat` and `end_combat`;
- placement (`placeCharacters`, `ensureCharacterTokens`);
- `partyDown` (defeat) and `dyingCharacters`;
- default rest targets.

Timed conditions of away PCs are not expired by another scene's fight (`expireOrphaned`,
`endTimedConditions`).

The campaign's death rule (`partyDead`, `deathRuleMet`) still counts **every** PC.

## Voice DM

`buildInstructions` adds the following:
- **CURRENT LOCATION (IN FOCUS)** while the party is split;
- an **OTHER GROUPS** block, one line each from `otherGroups()`, for example
  "Bram at Old Mill (loc_mill): in combat, round 2, Wolf's turn (frozen)";
- a `[at Old Mill, not in focus]` tag on away PCs in PARTY.

A **SPLIT PARTY** persona section explains `character_ids`, cutting with `focus_scene`, finishing the
round before cutting away, the refusals, and regrouping.

`get_party_status` adds `where` for each PC and `other_groups`.

## Screens

- **Host, Party & spotlight** (`host/PartySpotlight.tsx`, rows from `host/partyGroups.ts`):
  - It is on the Adventure tab, and on the Play tab while the party is split.
  - It has one row per group: ★ marks the group on the TV, with a ⚔ round/turn badge ("(frozen)"
    when off screen) and a **Focus** button.
  - Each PC has a location dropdown that calls `change_scene` with `character_ids: [id]`.
  - The location card's button reads "Regroup here" while the party is split.
  - The Board tab shows "in focus · party split".
- **TV**:
  - It draws the scene in focus as usual.
  - Under the location name, `table/otherGroups.ts` adds one line per other group, for example
    "Bram · Old Mill · ⏸ ⚔ round 2".
  - Away PCs' party cards are dimmed and tagged "@ Old Mill".
- **Phone**:
  - The header 📍 shows the character's own location.
  - `PlayerMap` is a view-only SVG of that location, wherever the group is. It draws the picture,
    the group's fog, visible doors, loot, and auras for interactables. Monsters the table can't see
    are not drawn. The player's own token has a pulsing gold ring. Tapping a token names it, and
    "Zoom to me" shows a 12×12 window around the token. The plan comes from `player/playerMap.ts`.
  - When the character's fight is frozen, the phone shows "⏸ Paused …" instead of "Your turn!".
  - A physical roll waiting in a parked scene says it waits for the DM.

## Limits

- A physical roll asked for in a parked scene can be entered only once that scene is in focus again.
- When a mover was the current creature in the fight they leave, the turn passes in the frozen fight
  without that creature's start-of-turn effects. They run when the next turn starts after focus
  returns.
- The host Board edits only the scene in focus. To edit another group's board, focus it first.
