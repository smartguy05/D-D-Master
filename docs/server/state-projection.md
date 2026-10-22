---
title: State projection (server-side filtering of hidden information)
area: server
topic: state-projection
related_code:
  - packages/shared/src/projection.ts
  - packages/shared/src/projection.test.ts
  - packages/shared/src/visibility.ts
  - packages/shared/src/visibility.test.ts
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
| `state` | `publicState(state)`. If the set of visited locations changed, the public `campaign` is sent **first** (the new location's map and walls live in the campaign) |
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
- **Rolls** (`publicRoll`): a `secret` roll keeps its notation and label but its dice values,
  modifier and total become 0 and `dc`/`success` are removed. A hidden creature's roll becomes a plain
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
  cover note loses its ` vs AC N`.
- **Map objects**: only those `mapObjectShownOnTable` allows (not hidden, cell explored) on visited
  locations.
- **Fog, `featureEdits`, `wallEdits`**: only for visited locations. Edited features follow the
  same rule as the campaign's (below): interactive ones only once a cell of theirs was seen.
- **Players**: `aiPersona` is emptied. **Characters and visible monsters**: in `conditionMeta`, a
  `casterId` or `until.entityId` naming a hidden creature is removed.

**Visited locations** (`visitedLocations`): the focused location, parked scenes, locations of PCs
away from the focus, and every location with at least one explored fog cell. A fog-off location (a
shop) counts while someone is there.

## `publicCampaign(campaign, state)`

Keeps the name, premise, session summaries and status. In the outline: the title, **visited
locations only** (with `mapPrompt` emptied; name, description, map and walls stay; features keep the
plain ones and the interactive ones `interactiveFeatureShownOnTable` allows, so a "Secret lever" in an
unexplored room isn't sent), and NPC
names and descriptions (motive and voice emptied). The hook, acts and encounters are emptied.
Without a state, or with another campaign's state, no locations are kept.

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

- NPC descriptions, location descriptions of visited places, the premise and session summaries are
  sent as written. Don't put secrets there; use the hook, acts, encounters or NPC motives.
- A save or check `dc` with no target is still sent (it is said aloud at the table anyway).
- The TV (full state) still shows ` vs AC N` in its roll toast for a roll with cover.
- Rolls saved before `unseen` existed are judged on the current state only.
- A visible monster's name is sent. A disguised creature needs a neutral name.
