---
title: Documentation map
area: reference
topic: docs
related_code:
  - scripts/docs_index.py
  - docs/index.json
created: 2026-09-24
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude
status: current
change_log:
  - "2026-10-21: Server area lists voice call ownership"
  - "2026-09-24: Initial documentation set for the vertical slice"
  - "2026-10-18: Server area lists SRD spell/class data"
  - "2026-10-20: Area table lists every current doc (history and bundles, player phone view, rules engine, turn economy, demo video)"
  - "2026-10-21: Server area lists voice handover; setup lists the desktop + laptop HTTPS setup"
---

# Documentation map

The docs are grouped by area. Each file is 500 lines or fewer and starts with audit front matter
(`title`, `area`, `topic`, `related_code`, dates, `audited_by`, `status`, `change_log`).

| Area | Folder | What's there |
|---|---|---|
| Architecture | `docs/architecture/` | System overview, runtime data flow (a voice turn end-to-end), state model |
| Server | `docs/server/` | Realtime sideband, planned voice-call handover, voice call ownership (/table carries the call), tool engine, brain providers, images, rules search, SRD spell/class data, speaker ID, persistence, history (undo) and campaign bundles, HTTP/WS API |
| Web | `docs/web/` | Host control screen, table (TV) display, player phone view, 3D dice |
| Gameplay | `docs/gameplay/` | Running a session, character creation paths, physical vs virtual dice, rules engine (spells, rests, levels, death saves), turn economy |
| Setup | `docs/setup/` | Install and run (incl. desktop server + laptop table over HTTPS), configuration (env vars), testing, demo video |
| Reference | `docs/reference/` | DM tool catalog, GameState schema |

## Finding docs for code

```bash
python3 scripts/docs_index.py find apps/server/src/engine/tools.ts   # docs for a file
python3 scripts/docs_index.py topic dice                              # docs for a topic/area
python3 scripts/docs_index.py list                                    # everything + audit dates
python3 scripts/docs_index.py check                                   # validate (CI-style)
python3 scripts/docs_index.py stale                                   # code changed after last audit
python3 scripts/docs_index.py audit docs/web/dice-3d.md               # stamp last_audited = today
python3 scripts/docs_index.py rebuild                                 # regenerate docs/index.json
```

`docs/index.json` is generated from the front matter. It maps every `related_code` glob to its
docs (`by_code`), and groups docs `by_topic` and `by_area`. Never edit it by hand.

## Keeping docs current

When you change code:
1. Run `find` on the files you touched.
2. Update those docs, set `last_updated`, `last_audited` and `audited_by`, and add a dated `change_log` line.
3. If a new file isn't covered by any doc, add it to the most relevant doc's `related_code`.
4. Run `rebuild` and then `check` before committing.
