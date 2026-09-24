---
title: Persistence (SQLite + asset files)
area: server
topic: persistence
related_code:
  - apps/server/src/db/**
  - apps/server/src/game/history.ts
  - apps/server/src/game/bundle.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Added state_history table, undo and export/import summary"
  - "2026-09-24: Initial version"
---

# Persistence

`apps/server/src/db/index.ts` → `Store` wraps `better-sqlite3` (synchronous, WAL mode, foreign keys on).
The database is at `<DATA_DIR>/dm.sqlite` (default `campaigns/dm.sqlite`, which is git-ignored).

| Table | Columns | Notes |
|---|---|---|
| `campaigns` | `id`, `data` (JSON `Campaign`), `updated_at` | Sorted by `updated_at` desc. The server auto-loads the newest on start |
| `game_states` | `campaign_id`, `data` (JSON `GameState`), `updated_at` | Overwritten on every commit |
| `events` | `id`, `campaign_id`, `ts`, `type` (`log`, `tool`), `payload` | Append-only history. Session recaps read the `log` events since the session started |
| `voiceprints` | `campaign_id`, `player_id`, `embedding` (Float32 BLOB), `samples` | Voice ID; deleted along with the player |
| `state_history` | `id`, `campaign_id`, `version`, `ts`, `label`, `data` (JSON `GameState`) | Undo snapshots: the state *before* each labelled change, newest 50 per campaign. See [history and bundles](history-and-bundles.md) |

Deleting a campaign cascades to its rows and removes `<DATA_DIR>/<id>/`, which holds the generated
images.

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
