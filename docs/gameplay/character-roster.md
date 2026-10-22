---
title: Character roster
area: gameplay
topic: roster
related_code:
  - apps/server/src/game/roster.ts
  - apps/server/src/game/roster.test.ts
  - apps/server/src/game/service.roster.test.ts
  - apps/server/src/routes/roster.ts
  - apps/server/src/routes/roster.test.ts
  - apps/server/src/db/roster.test.ts
  - packages/shared/src/schemas.roster.test.ts
  - apps/web/src/host/RosterPanel.tsx
  - apps/web/src/host/roster.ts
  - apps/web/src/host/roster.test.ts
created: 2026-10-20
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Phone Saved tab; phone-made characters saved on join"
  - "2026-10-21: The campaign id `roster` is reserved: delete/load of it answer 400"
  - "2026-10-20: Fixes: undoing a join drops the copied voiceprint; portrait URL carries a ?v= content hash; panel refetches when the campaign ends"
  - "2026-10-20: Initial version (global roster, save/join/delete, end_campaign auto-save, host Roster panel and end prompt)"
---

# Character roster

The roster keeps heroes between campaigns. It is **global**: one list for the whole server, not
per campaign, and deleting a campaign never touches it. The campaign id `roster` is reserved (its media folder holds
the roster portraits), so deleting or loading a campaign with that id is refused with a 400. A roster hero keeps its level, abilities,
features, spells, items, gold, subclass, portrait and the player's voiceprint, so the player does
not have to record their voice again in the next campaign.

## Data

- `Character.rosterId?` (`ros_…`) links a campaign character to its roster entry. Old saves have
  none (optional field, no default).
- SQLite (see [persistence](../server/persistence.md)):
  - `roster_characters (id, name, data, created_at, updated_at)`: `data` is a JSON `Character`
    snapshot.
  - `roster_voiceprints (roster_id, embedding, samples)`: same Float32 format as `voiceprints`;
    deleted with its roster row (cascade).
- Portraits: `<DATA_DIR>/roster/assets/<rosterId>.png`, served as
  `/media/roster/<rosterId>.png?v=<content hash>` by the existing media route. The file is
  overwritten on every save and `/media` is cached `immutable`, so the `?v=` hash (first 12 hex of
  the file's SHA-1) gives each portrait version its own URL. Campaign folders are deleted with their campaign, so the sprite is
  copied out.
- `RosterEntry` (what `GET /api/roster` returns; see [game state](../reference/game-state.md)):
  `id, name, playerName, className, subclass, level, species, spriteUrl?, hasVoiceprint,
  updatedAt, campaignsPlayed?`.

## The snapshot (`snapshotForRoster`, `game/roster.ts`)

Pure; built on `freshCharacter` from `game/reset.ts`. It keeps everything that describes the hero
(name, player name, species, class, subclass, level, background, abilities, max HP, AC, speed,
proficiency, skills, saves, attacks, spells, features, inventory, gold, notes, appearance,
sprite, dice mode, colour, light radius, slot/pact/Hit Dice/resource maxima, `rosterId`) and
resets what a rest would: HP to max, no temp HP, no conditions or condition links, no
concentration, death saves cleared, every slot, pact slot, Hit Die and resource unused. Item
`iconUrl`s are cleared because they point at campaign media.

## Saving

`GameService.saveToRoster(characterId)` (`POST /api/roster/save/:characterId`):
- The first save makes a new `ros_…` id, writes the row and sets the campaign character's
  `rosterId`. The link is a committed, broadcast change **without** an undo entry.
- Later saves update the same row (`updated_at` moves forward). If the host deleted the row, it is
  recreated under the same id.
- The portrait is copied from `/media/<campaignId>/<file>.png` when the file exists; otherwise the
  previous roster portrait stays.
- When the character's player has a voiceprint in this campaign, it replaces the roster
  voiceprint. Otherwise the roster voiceprint is left alone.

`saveAllToRoster()` (`POST /api/roster/save-all`) saves every character in the campaign.

**Automatic save at the end of a campaign:** `end_campaign` saves every PC that has a `rosterId`
with its end-of-campaign state (new level, gold, items). Unlinked PCs are only listed in the
result (`roster: {saved, unlinked}`, see the [tool catalog](../reference/tool-catalog.md)); a
failing save is logged and skipped, and the campaign still ends.

## Joining a campaign

`GameService.joinFromRoster(rosterId, playerId?)` (`POST /api/roster/:id/join`):
- Refused when the hero is already in this campaign (a character with that `rosterId`).
- Adds a copy with a **new** `pc_…` id, the same `rosterId`, full HP, and item ids made unique in
  the campaign. Tokens are placed as for a new character. Undoable (`host edit: join from roster
  <name>`), and the DM's instructions are refreshed.
- Player: the given `playerId` (it must not already play a live character); otherwise a player
  with the same name as the hero's player (case-insensitive) who plays no one; otherwise a new
  player. If a player with that name already plays someone else, the join asks for an explicit
  player.
- Voice: the roster voiceprint becomes that player's voiceprint in this campaign unless they
  already have one, so voice ID recognises them at once. The voiceprint table is outside
  GameState, so undo/rewind cleans it up itself (`restoreEntry` -> `dropVoiceprintsUndoneBy`): a
  roster voiceprint copied by an undone join onto a player who had none is deleted, and so is
  every row whose player is not in the restored state. The join also prunes such orphan rows
  first, so one embedding never appears twice (that would make speaker matches never confident).
- Portrait: copied into the campaign's assets; without one a sprite is drawn, as for a new
  character.

## Deleting

`deleteRoster(id)` (`DELETE /api/roster/:id`) removes the row, its voiceprint and its portrait.
Campaign characters that still carry the id keep it; saving one again recreates the entry.

## Host screen

In the **🛡 Party** tab (see [host UI](../web/host-ui.md)):
- Each character has **Save to roster**, or **Update roster** with a *linked* badge once it has a
  `rosterId`. The Characters header has **💾 Save all to roster**.
- *Add a character → Bring an existing hero* opens the Roster panel (`RosterPanel.tsx`): portrait
  (or initial), name, `rosterLabel` (`Fighter (Champion) · Lv 5`), player, voice badge and
  "updated … ago". **Join campaign** takes an optional player (players with no live character);
  it is disabled with the reason when the hero is already here (`joinBlocked`). **Delete** asks
  first. The list refetches after every save, join or delete, and when the campaign ends
  (`rosterRefreshKey`), since `end_campaign` saves linked PCs on the server.
- After `end_campaign` (status completed or failed), the host page shows a dismissible banner
  listing the unlinked characters (`rosterPrompt`) with **💾 Save all to roster**. It hides once
  none are unlinked.

## Bundles and undo

- Export keeps `rosterId`; import keeps it too but never writes the roster tables (see
  [history and bundles](../server/history-and-bundles.md)).
- Undoing to a snapshot older than the link drops `rosterId`; saving again then makes a second
  roster entry. This is accepted.

## Known gaps

- A campaign with the id `roster` would share `<DATA_DIR>/roster` with the roster portraits.
  Campaign ids are always `cmp_…`, but `deleteCampaign` does not check the id
  (`.memories/bugs/roster-media-dir-collision.md`).
- `campaignsPlayed` is in the schema but nothing counts it yet.

## From a phone

The phone's Saved tab lists the whole roster (`GET /api/players/:id/roster`): this player's own heroes
(same player name, any case or spacing) first, flagged `mine`, with `levelMismatch` and `inCampaign`.
Play joins the hero for that seat only (`playerJoinFromRoster`). A character made on a phone is
saved to the roster as soon as it joins. See [phone creation](phone-creation.md).
