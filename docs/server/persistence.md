---
title: Persistence (SQLite + asset files)
area: server
topic: persistence
related_code:
  - apps/server/src/db/**
  - apps/server/src/game/history.ts
  - apps/server/src/game/bundle.ts
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: character_drafts table"
  - "2026-10-21: Float32 embedding decoding: copy before viewing (unaligned pooled Buffers)"
  - "2026-10-21: Campaign id roster is reserved (Store.getCampaign returns undefined, deleteCampaign throws); DATA_DIR/certs holds the self-signed HTTPS cert"
  - "2026-10-20: GameState gains scenes/partyLocations (defaults keep old saves loading)"
  - "2026-10-20: roster_characters and roster_voiceprints tables; roster portraits in <DATA_DIR>/roster/assets"
  - "2026-10-19: Store.deleteEvents, deleteVoiceprints, deletePlayerNotes (campaign reset)"
  - "2026-10-19: player_notes table"
  - "2026-09-24: Added state_history table, undo and export/import summary"
  - "2026-09-24: Initial version"
  - "2026-10-18: kv table with the active voice call record"
---

# Persistence

`apps/server/src/db/index.ts` → `Store` wraps `better-sqlite3` (synchronous, WAL mode, foreign keys on).
The database is at `<DATA_DIR>/dm.sqlite` (default `campaigns/dm.sqlite`, which is git-ignored).

| Table | Columns | Notes |
|---|---|---|
| `campaigns` | `id`, `data` (JSON `Campaign`), `updated_at` | Sorted by `updated_at` desc. The server auto-loads the newest on start |
| `game_states` | `campaign_id`, `data` (JSON `GameState`), `updated_at` | Overwritten on every commit |
| `events` | `id`, `campaign_id`, `ts`, `type` (`log`, `tool`), `payload` | Append-only history. Session recaps read the `log` events since the session started. A campaign reset deletes them (`deleteEvents`) |
| `voiceprints` | `campaign_id`, `player_id`, `embedding` (Float32 BLOB), `samples` | Voice ID; deleted along with the player |
| `player_notes` | `campaign_id`, `player_id`, `text`, `updated_at` | Private phone notes (`GET/PUT /api/players/:id/notes`). Kept out of `GameState` on purpose: the state is broadcast to every screen and read by the DM. Not part of undo or campaign bundles; cascades with the campaign |
| `kv` | `key`, `value` (text) | Small server settings. `active_voice_call` = JSON `{callId, campaignId, startedAt}` of the live voice call, so a restarted server can re-attach its sideband (`get/set/clearActiveCall`) |
| `roster_characters` | `id` (`ros_…`), `name`, `data` (JSON `Character`, a fresh snapshot), `created_at`, `updated_at` | The global character roster ([character roster](../gameplay/character-roster.md)). Not tied to a campaign: deleting a campaign leaves it. `listRoster` (newest first), `getRoster`, `saveRoster` (upsert; keeps `created_at`, `updated_at` always moves forward), `deleteRoster` |
| `roster_voiceprints` | `roster_id` → `roster_characters(id)` ON DELETE CASCADE, `embedding` (Float32 BLOB, same format as `voiceprints`), `samples` | A roster hero's voiceprint, copied from/to `voiceprints` on save/join (`get/saveRosterVoiceprint`) |
| `state_history` | `id`, `campaign_id`, `version`, `ts`, `label`, `data` (JSON `GameState`) | Undo snapshots: the state *before* each labelled change, newest 50 per campaign. See [history and bundles](history-and-bundles.md) |

Deleting a campaign cascades to its rows and removes `<DATA_DIR>/<id>/`, which holds the generated
images. The roster tables and `<DATA_DIR>/roster/assets/` (roster portraits, served as
`/media/roster/<rosterId>.png`) are not touched. The id `roster` is reserved for that folder:
`GameService.loadCampaign`/`deleteCampaign` refuse it (HTTP 400), and as a second guard
`Store.getCampaign("roster")` returns `undefined` and `Store.deleteCampaign("roster")` throws.

Voiceprint embeddings are little-endian Float32 bytes. To read one, **copy the bytes first**:
`blobToFloat32` in `db/index.ts` slices the buffer, and bundle import (`game/bundle.ts`) decodes
base64 into a fresh `Uint8Array`. Node hands out pooled `Buffer`s whose `byteOffset` may not be a
multiple of 4, so `new Float32Array(buf.buffer, buf.byteOffset)` throws there.

`<DATA_DIR>/certs/` holds the self-signed certificate for the HTTPS listener (`cert.pem`,
`key.pem` with mode 600, and `meta.json` with its IP SANs and expiry), made by `tls.ts`
`loadOrCreateCert`. It is not a campaign folder and is not part of any export.

## Save and resume

- The state is saved on **every** mutation, so there's nothing to "save". Restart the server and
  the latest campaign loads exactly as it was.
- **End session** (Adventure tab):
  1. Collects the `log` events since the session started.
  2. Asks the brain for a recap (or stores the raw tail if there's no brain).
  3. Appends it to `campaign.sessionSummaries`.
  4. Stops the DM.

  At the next start, `openingPrompt` asks the DM to open with that recap, and `buildInstructions`
  includes it.
- A split party is saved as it stands: `GameState.scenes` (other groups' parked scenes, frozen
  fights included) and `partyLocations` are part of the state blob, so a restart resumes the split.
  Both default to `{}`, so older saves load unchanged ([party split](../gameplay/party-split.md)).

## Undo, export and import

- **Undo**: the Play tab's *Undo* button and *History* dropdown restore a snapshot from
  `state_history` (whole state, voiceprints untouched).
- **Export / import**: a campaign exports to one `.dmc.json.gz` file with its campaign, state,
  voiceprints, recent events and images. Importing it always creates a **new** campaign id and
  rewrites the `/media/<id>/` URLs.

Details are in [history and bundles](history-and-bundles.md).

## Why JSON blobs?

The state is always read and written whole and broadcast whole. Zod parsing on load (`GameState.parse`)
fills defaults for new fields, which is the migration path: add a field with `.default(...)` in
`schemas.ts`, and older saves still load.

## Character drafts

`character_drafts (campaign_id, player_id, data, updated_at)`: one phone character draft per seat
(`CreationDraft` JSON, chat included). Not in GameState, undo history or campaign bundles; deleted
with the campaign (cascade) and by a reset that doesn't keep players. See
[phone creation](../gameplay/phone-creation.md).
