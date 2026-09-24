# Feature: Save / resume
Status: done (vertical slice)
Docs: docs/server/persistence.md

## Overview
SQLite (better-sqlite3): campaigns, game_states (saved on every mutation), an append-only events
log, and voiceprints. End session → brain recap → next session opens with it.

## TODOs
- [ ] Undo last tool call (the event log has everything needed)
- [ ] Export/import a campaign as a zip
- [ ] Multiple saves / branches per campaign

## Completed
- 2026-09-24: Store, auto-load of the latest campaign, end-session recap, demo seed script.
