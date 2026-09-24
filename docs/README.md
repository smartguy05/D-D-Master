---
title: Documentation map
area: reference
topic: docs
related_code:
  - scripts/docs_index.py
  - docs/index.json
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial documentation set for the vertical slice"
---

# Documentation map

The docs are grouped by area. Each file is 500 lines or fewer and starts with audit front matter
(`title`, `area`, `topic`, `related_code`, dates, `audited_by`, `status`, `change_log`).

| Area | Folder | What's there |
|---|---|---|
| Architecture | `docs/architecture/` | System overview, runtime data flow (a voice turn end-to-end), state model |
| Server | `docs/server/` | Realtime sideband, tool engine, brain providers, images, rules search, speaker ID, persistence, HTTP/WS API |
| Web | `docs/web/` | Host control screen, table (TV) display, 3D dice |
| Gameplay | `docs/gameplay/` | Running a session, character creation paths, physical vs virtual dice |
| Setup | `docs/setup/` | Install and run, configuration (env vars), testing |
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
2. Update those docs, set `last_updated` and `last_audited`, and add a `change_log` line.
3. If a new file isn't covered by any doc, add it to the most relevant doc's `related_code`.
4. Run `rebuild` and then `check` before committing.
