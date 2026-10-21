---
name: finish-change
description: End-of-change checklist for this repo — tests, docs front matter + docs_index.py, bug/feature/decision memories, Intent line. Use before every commit or when wrapping up a turn that edited code, and when recording a bug.
---

# Finish a change

## 1. Tests
`pnpm test && pnpm typecheck`. Engine, parsing, matching, dice and session-loop changes need a
Vitest test next to the code.

## 2. Docs
```bash
python3 scripts/docs_index.py find <changed files>   # which docs cover them
```
- Update each doc that covers the files. In its front matter, set `last_updated` and `last_audited` to today, set `audited_by`, and add
  a dated `change_log` entry.
- A new file that no doc covers goes into the best doc's `related_code`, or into a new doc with full front matter.
- **Every doc must be 500 lines or fewer.** If a doc is above about 450 lines, split it instead of squeezing it.
- `python3 scripts/docs_index.py rebuild && python3 scripts/docs_index.py check` must report 0 errors.
  Commit `docs/index.json` too. Rebuild it after every merge.
- Gotchas worth keeping go in the doc for that area, not only in a memory. The doc for cross-cutting rules
  is `docs/architecture/design-rules.md`.

## 3. Memories (`.memories/`, format in `.memories/README.md`)
- **Every bug you found gets `bugs/<slug>.md`, even if you fixed it at once.** Fill in Root cause / Fix
  with the fix that actually shipped, not "Fix idea", plus the function names and the test that covers it. Cite
  event numbers or the campaign id when the bug came from a test run.
- In the feature file, move finished TODOs to Completed with a date, and keep `Status:` honest. A feature with only
  live tests left is `done (vertical slice)`. Remove statements that the change made false.
- A TODO that needs a real table, voice or TV gets added to `general/live-test-checklist.md`.
- Product choices the user made go in `general/decisions.md` (dated, with the rejected alternatives).
  External API quirks go in `api-notes.md`, and machine or tooling traps in `environment.md`.

## 4. Before committing
- No `AI-REJECTED` comment may remain. The pre-commit hook refuses the commit.
- Model names appear only in `config.ts` and `.env.example`.
- Commit the code, tests, docs, `docs/index.json` and memories together.
- End the reply with the `Intent: …` line (CLAUDE.md).
