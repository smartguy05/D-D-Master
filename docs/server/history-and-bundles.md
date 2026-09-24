---
title: Undo history, campaign export/import and outline editing
area: server
topic: persistence
related_code:
  - apps/server/src/game/history.ts
  - apps/server/src/game/bundle.ts
  - apps/server/src/game/outline.ts
  - apps/server/src/routes/campaign.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version (undo/restore, .dmc.json.gz bundles, PUT outline)"
---

# Undo history, export/import and outline editing

Three campaign-management features. Each has its logic in its own module under
`apps/server/src/game/`, with small wiring in `GameService` and the HTTP routes in
`apps/server/src/routes/campaign.ts` (registered from `index.ts` next to `registerApi`).

## Undo history (`history.ts`)

**What is stored.** `StateHistory` writes rows to the SQLite table `state_history`
(`id, campaign_id, version, ts, label, data`). Each row is the **whole `GameState` from just before a
labelled change**. The newest 50 rows per campaign are kept (`HISTORY_LIMIT`), and older ones are
pruned on write. Rows cascade-delete with their campaign. Voiceprints are never stored in history:
they live in the `voiceprints` table, and `GameState` only has a `voiceSamples` count per player.

**When a row is written.** `GameService.commit(state, label?)` records the previous state when a
label is given:

| Cause | Label example |
|---|---|
| Engine tool from the DM | `apply_damage Thorin amount=5` (`toolLabel` replaces entity ids with names) |
| Engine tool from the host (`/api/tools/:name`, physical roll) | `host: heal Thorin amount=2` |
| Host edits (`addPlayer`, `updatePlayer`, `removePlayer`, `addCharacter`, `updateCharacter`, `removeCharacter`) | `host edit: Thorin (hp, conditions)` |

These are **not** recorded: log lines (DM/player speech), speaker badges, sprite URLs arriving from
image jobs, voice sample counts, and tools that leave the state unchanged apart from `version` (for
example `get_party_status`; see `sameState`). Labels are single-line and at most 90 characters.

**Undo and restore.**
- `GameService.undo()` restores the newest row. `restoreHistory(version)` restores the newest row
  with that snapshot `version`. Both drop that row and every newer one. There is no redo.
- `restoredState()` builds the committed state from the snapshot:
  - It is a whole-state restore, so combat, tokens, monsters and the log stay consistent with each
    other.
  - `version` is set to the current version + 1, so clients never see it go backwards.
  - `activeSpeaker` is cleared.
  - Each player's `voiceSamples` comes from the live `voiceprints` table.
- After the restore the service:
  1. adds a `system` log line: `Host undid: <label>`, or `Host rewound to before: <label>`;
  2. commits and broadcasts the state;
  3. appends `log` and `undo` events;
  4. if a DM session is running, calls `refreshInstructions()` and adds a system note. The note tells
     the DM to treat the action as never having happened. No response is requested, so the DM
     doesn't talk over the table.
- Dice animations that already played are not "un-rolled" on the TV. The roll is only removed from
  `state.rolls`.

## Export / import (`bundle.ts`)

A campaign exports to one gzip file, `<slug>.dmc.json.gz`. It holds one JSON object:

```json
{ "format": "dm-campaign", "version": 1, "exportedAt": 0,
  "campaign": { /* Campaign */ }, "state": { /* GameState */ },
  "voiceprints": [{ "playerId": "plr_…", "samples": 3, "embedding": "<base64 Float32 LE>" }],
  "events": [{ "ts": 0, "type": "log", "payload": {} }],
  "assets": { "map_ab12cd34ef56.png": "<base64 PNG>" } }
```

- `buildBundle(store, dataDir, id, {events})` reads the campaign, state and voiceprints. It includes
  the newest `BUNDLE_MAX_EVENTS` (5000) events unless `events: false`
  (`?events=0` on the HTTP route). It also includes every `*.png` in `<dataDir>/<id>/assets`.
  Undo history is **not** exported.
- `decodeBundle` accepts gzip bytes (it checks the magic bytes), plain JSON bytes or an object. It
  validates the envelope with zod and rejects anything that isn't a `dm-campaign` v1 file.
- `importBundle(store, dataDir, bundle, newId)`:
  - always creates a **new** campaign (`newId("cmp")` in the service), so an import never
    overwrites anything;
  - rewrites `/media/<oldId>/` to `/media/<newId>/` everywhere in the campaign, state and event
    payloads (`rewriteMediaUrls`);
  - re-parses the campaign and state with the current schemas, so older exports get new defaults;
  - writes the campaign, state, voiceprints and events in one SQLite transaction, then writes the
    asset files. Asset names must match `^[\w.-]+\.png$`, which blocks path traversal.
- The imported campaign isn't loaded automatically. Its `updatedAt` is the import time, so it sorts
  first and is auto-loaded the next time the server starts.
- The upload limit is `BUNDLE_MAX_BYTES` (200 MB), set as the route's `bodyLimit`. The global
  Fastify limit stays at 5 MB.

## Outline editing (`outline.ts`)

`PUT /api/campaign/outline` takes a whole `Outline`. `mergeOutline(prev, input)`:
- gives an id to any location or encounter that has none;
- validates the result with the shared `Outline` zod schema (grid 4–60, monster count ≥ 1, …). The
  error names the first bad path, e.g. `Invalid outline: locations.0.gridW: …`;
- rejects duplicate location ids and encounters that point at an unknown location;
- treats `mapUrl` as server-owned. A location keeps its saved `mapUrl` only if the location existed
  before and its `mapPrompt` is unchanged. Otherwise `mapUrl` is cleared so the host can repaint it.
  A `mapUrl` sent by the client is ignored.

`GameService.updateOutline` then saves and broadcasts the campaign. If a DM session is running, it
also calls `refreshInstructions()` so the DM sees the new locations and NPCs.

## HTTP routes

See [HTTP API](http-api.md#campaign-management) for the table. Tests:
`apps/server/src/game/{history,bundle,outline}.test.ts`.
