# Feature: Save / resume
Status: done (vertical slice)
Docs: docs/server/persistence.md, docs/server/history-and-bundles.md

## Overview
SQLite (better-sqlite3): campaigns, game_states (saved on every mutation), an append-only events
log, and voiceprints. End session → brain recap → next session opens with it.

## Notes
- Undo = whole-GameState snapshots in `state_history` (pre-change state + label), written by
  `GameService.commit(state, label)`. Only labelled commits (tools, host edits) create entries, so
  log lines / speaker badges / sprite URLs don't flood the 50-entry window. Read-only tools are
  skipped via `sameState` (ignores `version`).
- Restore bumps `version` above the current one (never backwards), clears `activeSpeaker`, and
  re-syncs `voiceSamples` from the voiceprints table (voiceprints are never in history).
- Export is a gzipped JSON bundle (no zip dep). Import always creates a new campaign id and rewrites
  `/media/<old>/` -> `/media/<new>/` by string replace over the serialized JSON.
- Base64 -> Float32Array: copy into a fresh Uint8Array first; pooled Buffers can have an unaligned
  byteOffset and `new Float32Array(buf.buffer, buf.byteOffset)` would throw.

## TODOs
- [ ] Multiple saves / branches per campaign
- [ ] Redo (undo currently drops the undone entries)
- [ ] Optional: undo also re-syncs the TV dice tray (already-played animations stay visible)

## Completed
- 2026-09-24: Undo last action + history dropdown (state_history, last 50, GET/POST /api/history*).
- 2026-09-24: Campaign export/import as a single .dmc.json.gz (state, voiceprints, events, images).
- 2026-09-24: Store, auto-load of the latest campaign, end-session recap, demo seed script.
