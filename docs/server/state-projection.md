---
title: State projection (server-side filtering of hidden information)
area: server
topic: state-projection
related_code:
  - packages/shared/src/projection.ts
  - packages/shared/src/projection.test.ts
  - packages/shared/src/visibility.ts
  - packages/shared/src/visibility.test.ts
  - packages/shared/src/fog.ts
  - apps/server/src/publicFeed.ts
  - apps/server/src/publicFeed.test.ts
  - apps/server/src/hub.ts
  - apps/server/src/hub.test.ts
  - apps/server/src/engine/rolls.ts
created: 2026-10-22
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Character drafts are outside GameState; the creation event"
  - "2026-10-22: Review: PublicFeed re-sends the campaign when a visited location's seen walls/features change (not only the visited set); fog-off entries lose the hidden list too; a secret roll loses attack, targetId and cover (bugs/player-map-frozen-at-arrival.md, bugs/secret-roll-attack-leak.md)"
  - "2026-10-22: Map layout and secret label leaks: features (plain too) only once a cell was seen (featureShownOnTable); fog without the host's hidden list; walls/doors per location only next to a seen cell (doorVisible, moved to shared); secret rolls lose label and modifier (bare dice) and their log line reads '<roller> rolled in secret' (bugs/player-map-layout-leak.md, bugs/secret-roll-label-leak.md)"
  - "2026-10-22: publicCampaign drops session summaries (brain DM NOTES or raw log), the premise, all NPCs and visited locations' descriptions, with or without an outline; Not covered no longer calls them safe"
  - "2026-10-22: Phase 5: peers/rtc go to call members through Hub.send and pass unchanged"
  - "2026-10-22: attitudeScore kept for visible monsters (the TV's badge shows it; stripping it made /play show a band default)"
  - "2026-10-22: The remote page /play/:id ships (phase 4) and gets the projection"
  - "2026-10-22: floor events pass to players unchanged"
  - "2026-10-22: Unexplored interactive features filtered (campaign and featureEdits); hidden ids dropped from conditionMeta.until and monsters' conditionMeta; hidden current entry gives turnIndex -1 out of combat too"
  - "2026-10-22: Review fixes: attack rolls and pending attacks lose the target's AC (dc, ' vs AC' in roll lines); RollResult/LogEntry.unseen keeps a removed hidden creature's rolls anonymous; publicLogEntry shared by publicState and the log event"
  - "2026-10-22: Initial version (online play phase 2: viewer tiers, publicState/publicCampaign, PublicFeed, trimmed phone roll replies)"
---

# State projection

Players must not be able to read hidden information from their browser's network tab. The host and
the TV get the full `GameState` and `Campaign`. A player's phone (`/player/:id`) and the remote
page (`/play/:id`, see [remote play](../web/remote-play.md)) get a **public projection** that the server builds with the TV's own
visibility rules. Access levels come from [authentication](auth.md).

## Viewer tiers (`apps/server/src/publicFeed.ts` `viewerTier`)

Every `/ws` socket has a tier:

| Socket | Tier |
|---|---|
| Player cookie (remote, table code) | `public`, whatever its hello says |
| Host or table access, hello `host` or `table` (the laptop, the TV) | `full` |
| Host or table access, hello `player` (a phone on the trusted LAN, `/player` on this machine) | `public` |
| Host or table access, no hello yet | none yet: only public events, snapshot after the hello |

The tier follows the socket's **clamped** hello role (`clampRole`). A LAN phone has table access
(`TRUST_LAN`) but runs `/player`, which says hello `player`, so it gets the public view. A device on
the trusted LAN could still say hello `table` and get the full state: that is what `TRUST_LAN` means.
Set `TRUST_LAN=false` when the home network isn't trusted.

## The connect snapshot (`Hub.sendSnapshot`)

- A player cookie gets its public snapshot as soon as it connects.
- A host or table socket gets its snapshot right after its hello, built for the tier its role gives.
  It goes out before the hello listeners run, so the TV still gets `state` before the
  `voice_owner` that its hello triggers. Every web page sends its hello on `open`, so this is about
  one round trip later than before.
- A socket whose tier changes on a later hello gets a fresh snapshot for the new tier.

## Broadcasts (`Hub.broadcast`)

The event is serialised once for full sockets. If any non-full socket is open, `PublicFeed.next(ev)`
builds the public events once, and each is serialised once for all of them. Every socket gets its
events in the same order and at the same moment as before, so the TV's dice and moment timing is
unchanged (design rule 1). With only full sockets open, `PublicFeed.observe(ev)` just remembers the
latest state and campaign.

`PublicFeed` per event type:

| Event | Public version |
|---|---|
| `state` | `publicState(state)`. If what the public campaign shows changed (`shownKey`: the visited locations and, in each, the walls and features the party has seen), the public `campaign` is sent **first**: a new location's map and walls, or a door or feature that exploring brought into sight (or the host hid again) |
| `campaign` | `publicCampaign(campaign, latest state)`. A different campaign forgets the old state, so its first `state` re-sends the campaign with its locations |
| `roll` | `publicRoll(roll, latest state)` |
| `effect` | `effectForTable(latest state, effect)`; dropped when it lands on a creature the table can't see |
| `moment` | `momentForTable(latest state, moment)`; dropped for a hidden creature's death, revival, turn banner or attitude |
| `log` | `publicLogEntry(entry, latest state)`, the same filter as `publicState`'s log. Nothing broadcasts `log` today (log lines travel in `state`) |
| `job`, `error` | not sent (host chips and server errors) |
| anything else | unchanged (the same serialised message), e.g. `floor` (who holds the push-to-talk floor is not secret) |

`Hub.send(ws, ev)` to one non-full socket uses `publicSnapshot([ev])`. Sent this way: `voice_command`
(only to the TV) and the [online call](../web/online-call.md)'s `peers` and `rtc` (only to call
members; they carry peer ids, seats, camera/mic flags and WebRTC signaling, no game state, so they
pass unchanged).

## `publicState(state)` (`packages/shared/src/projection.ts`)

Pure, never changes its input. Hidden creatures are `hiddenCreatureIds(state)`: monsters for which
`monsterShownOnTable` is false (host-hidden, or in fog the party hasn't seen), in the focused scene
and in every parked scene (party split), each judged with its own location's fog.

- **Monsters**: hidden ones are removed with their tokens, initiative entries, turn budget and
  `reactionsUsed` entries, in `scenes` stashes too. Visible ones lose `srdName`, `abilities`, `cr`,
  `voice`; `ac` becomes 0, `attacks` `[]`, `initiativeBonus` 0 and
  `attacksPerAction` 1 (neutral values keep the `GameState` type). `hp`, `maxHp` and
  `attitudeScore` stay: the TV shows HP bars and the attitude badge with its score (without the
  score the badge would show a made-up band default such as "Hostile −3").
- **Turn**: when the current turn is a hidden creature's (in or out of combat), `turnIndex` becomes -1 and `turn` null, so
  no page shows it as anyone's turn (`order[-1]` is undefined). Otherwise `turnIndex` is re-pointed
  at the same entry in the filtered order.
- **Pending roll** (focused and parked scenes): aimed at a creature that isn't a PC, its `dc` (the
  target's AC, or a stat-block DC) is removed; no player page reads it. A save's `dc` with no target
  stays (the DM says it aloud). A `targetId` (and `attackName`) naming a hidden creature is removed.
- **Rolls** (`publicRoll`): a `secret` roll keeps its roller and dice sides, but its `label`
  becomes "" (it says what the DM checks: "Insight: is the mayor lying"), its `notation` the bare
  dice (`bareDiceNotation`: "1d20", "2d6+1d4"; the modifier would name the skill), its dice values,
  modifier and total become 0, `dc`/`success`/`targetId`/`cover` are removed and `attack` is false
  (a secret sniper's shot doesn't say it was an attack, at whom, or with what cover). A hidden creature's roll becomes a plain
  DM roll (`rollForTable`, extended to parked scenes), and a `targetId` naming a hidden creature goes.
  An attack roll (or any roll with a `targetId`) loses `dc`, the target's AC plus cover; `success`
  (hit or miss) and `cover` stay.
- **Sticky redaction (`unseen`)**: `makeRoll` (engine/rolls.ts) tags a roll and its log line
  `unseen: true` when the roller is in `hiddenCreatureIds` at that moment. Such a roll stays an
  anonymous DM roll and its log line stays dropped after the creature is removed, the scene changes or
  it dies, when the current-state check could no longer find it. A creature revealed later keeps its
  earlier rolls anonymous (conservative).
- **Log** (`publicLogEntry`): only `dm`, `player` and `roll` entries, minus roll lines tagged
  `unseen` or whose speaker is a hidden creature's name (and not a character's). A roll line's
  cover note loses its ` vs AC N`. A secret roll's line (`makeRoll`: "X rolled <label>: (secret)",
  matched by its `: (secret)` ending and the speaker) becomes "X rolled in secret".
- **Map objects**: only those `mapObjectShownOnTable` allows (not hidden, cell explored) on visited
  locations.
- **Fog, `featureEdits`, `wallEdits`**: only for visited locations. A fog-on entry goes out as
  `{ enabled, revealed: [...revealedSet(f)], hidden: [] }`: the host's hidden cells are a map of
  secret areas, so they are subtracted on the server and never listed. A fog-off entry goes out as
  is but with `hidden: []` too (`set_fog` disable keeps the list). Edited features and walls
  follow the same rules as the campaign's (below), each judged with its own location's fog.
- **Players**: `aiPersona` is emptied. **Characters and visible monsters**: in `conditionMeta`, a
  `casterId` or `until.entityId` naming a hidden creature is removed.

**Visited locations** (`visitedLocations`): the focused location, parked scenes, locations of PCs
away from the focus, and every location with at least one explored fog cell. A fog-off location (a
shop) counts while someone is there.

## `publicCampaign(campaign, state)`

Keeps the name, status, party level and death rule. In the outline: the title and **visited
locations only**, with `mapPrompt` and `description` emptied (name, map and grid stay). With fog on
at that location:

- **Features**: only those with at least one seen cell (`featureShownOnTable`), plain or
  interactive, so neither a "Secret lever" nor the lair, an exit or a named landmark in unexplored
  fog is sent.
- **Walls** (doors, windows, plain walls): only segments with a seen cell on either side
  (`doorVisible`, the TV's door rule, now in `visibility.ts`). No player page needs the rest: line
  of sight, light and pathing run on the server, and the TV and phone map draw only doors.

With fog off every feature and wall is kept. Emptied for players:

- `sessionSummaries`: `summarizeSession` (brain/content.ts) writes a "DM NOTES:" line from a state
  summary that lists hidden monsters, and without a brain the summary is the raw session log.
- `premise`: the host's pitch for the brain, which may name the twist.
- `outline.npcs`: every NPC in the outline, met or not (names and descriptions are spoilers).
- A visited location's `description`: written by the outline model, may foreshadow, unused by
  player pages.
- The hook, acts and encounters.

A campaign without an outline still loses its summaries and premise. Without a state, or with
another campaign's state, no locations are kept. Player pages read only `name`, `outline.title` and
`outline.locations` (map, walls, features, names for "away" tags).

## REST reads by players

- `POST /api/players/:id/roll` and `/physical-roll` answer callers below the host with
  `seatRollReply(result)`: `{ ok, total?, dmInformed? }` or `{ ok: false, error }`. The full tool
  result names the target's AC (`vs_ac`), DM hints and the next turn, which may be a hidden
  creature's. The host's own calls still get the whole result.
- `GET /api/players/:id/notes`, `PUT …/notes` and `GET …/spells` are bound to the caller's seat
  ([authentication](auth.md)); notes are the player's own text and spells their own character's.
- `GET /api/auth/claim` lists human seats with player and character names only.
- `GET /api/status` and every other host route need the host.
- `/media/<campaign>/<file>` stays public (sign-in pages and the TV load from it), but image file
  names are a hash of the model, size and prompt (`imageFileName`), and the public campaign carries
  neither unvisited maps' URLs nor any `mapPrompt`, so an unvisited map can't be found by name.

## Not covered

- Visited locations' names and the campaign and outline titles are sent as written. Don't put
  secrets in them.
- A save or check `dc` with no target is still sent (it is said aloud at the table anyway).
- The TV (full state) still shows ` vs AC N` in its roll toast for a roll with cover.
- Rolls saved before `unseen` existed are judged on the current state only.
- A visible monster's name is sent. A disguised creature needs a neutral name.

## Character drafts stay out of the projection

Phone character drafts (and their AI chat) are per seat, but `publicState` is per tier: every
phone gets the same projection. So drafts live in SQLite and travel over seat-scoped REST; the
`/ws` `creation` event carries only `{playerId, status, updatedAt, busy?}` and passes the player
feed unchanged. See [phone creation](../gameplay/phone-creation.md).
