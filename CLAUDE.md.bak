# CLAUDE.md

This is an AI Dungeon Master for in-person D&D 5e (2024, SRD 5.2). An OpenAI Realtime voice DM talks
with the table through one shared mic. It recognizes players by voiceprint after they say their name
once. The server runs every game mechanic through tools. A TV shows a 3D map, tokens, physics dice
and party stats.

## Layout

- `packages/shared` — zod schemas, DM tool definitions, events, dice notation (TS source, no build)
- `apps/server` — Fastify + ws. Contains:
  - `game/service.ts` (orchestrator)
  - `engine/` (pure tool reducers)
  - `realtime/` (voice DM + sideband)
  - `speaker/` (voice ID)
  - `brain/` (OpenAI/Anthropic planner)
  - `images/`
  - `rules/` (SRD search + monster catalog)
  - `db/` (SQLite)
- `apps/web` — React + R3F. `/host` (laptop controls), `/table` (TV), `/player/:id` (phone sheets), `src/dice` (3D dice)
- `data/srd` — SRD 5.2.1 markdown (CC-BY-4.0, keep `LICENSE.md`)
- `rules/custom` — house rules
- `docs/` — documentation (see below)
- `.memories/` — feature, bug and general memories (see below)

## Commands

```bash
pnpm install
pnpm test                 # vitest, all packages
pnpm typecheck            # tsc for shared/server/web
pnpm dev                  # server (tsx watch, :8787) + Vite (:5173)
pnpm build && pnpm start  # production: server serves apps/web/dist on :8787
pnpm --filter @dm/server seed:demo      # demo campaign, no API keys needed
pnpm --filter @dm/server eval:voiceid   # voice-ID accuracy (needs download-models.sh --with-tts)
bash scripts/download-models.sh         # speaker model into ./models
python3 scripts/docs_index.py check     # docs audit
```

Configuration is in `.env` (see `.env.example` and `docs/setup/configuration.md`). Never hard-code
model names outside `config.ts` and `.env.example`.

## Working rules

- **Tests first**: engine, parsing, matching, dice and session-loop changes need Vitest tests next to
  the code. Run `pnpm test && pnpm typecheck` before committing.
- All state changes go through `GameService.runTool` or service methods that `commit()`. Engine
  handlers must stay pure (they clone and return).
- New schema fields need `.default(...)` so saved campaigns still load.
- New or changed DM tool: update `ToolArgs`, `TOOL_DESCRIPTIONS`, the handler, a test,
  `docs/reference/tool-catalog.md`, and the persona in `realtime/instructions.ts` if the DM should
  use it on its own.

## Documentation — how to use it and keep it current

The docs live in `docs/`, grouped by area: `architecture/`, `server/`, `web/`, `gameplay/`,
`setup/`, `reference/`. Every doc:
- is **500 lines or fewer** (split it if it grows),
- starts with **audit front matter**: `title, area, topic, related_code (globs), created,
  last_updated, last_audited, audited_by, status (current|stale|draft), change_log`.

`docs/index.json` is **generated**. It maps code globs to docs (`by_code`), and groups docs
`by_topic` and `by_area`. Use the script (Python 3, stdlib only):

```bash
python3 scripts/docs_index.py find <file>...   # which docs cover these files? Run before editing
python3 scripts/docs_index.py topic <name>     # docs for a topic/area (dice, realtime, server…)
python3 scripts/docs_index.py list             # all docs with status + audit date
python3 scripts/docs_index.py stale            # docs whose code changed after last_audited
python3 scripts/docs_index.py audit <doc>...   # stamp last_audited=today (after reviewing it)
python3 scripts/docs_index.py rebuild          # regenerate docs/index.json
python3 scripts/docs_index.py check            # required fields, ≤500 lines, dead globs, index fresh
```

**Every code change must keep the docs current:**
1. Before editing, run `find` on the files you will touch and read those docs.
2. After editing, update those docs. Bump `last_updated` and `last_audited`, set `audited_by`, and
   add a dated `change_log` entry.
3. If you add a file that no doc covers, add it to the best doc's `related_code`, or write a new doc
   with full front matter in the right area folder.
4. Run `python3 scripts/docs_index.py rebuild && python3 scripts/docs_index.py check`. It must
   report 0 errors. Commit `docs/index.json` together with the docs.

## Memories — `.memories/`

Memories are durable project knowledge that is not documentation. The format is in
`.memories/README.md`.
- `.memories/features/<feature>.md` has **Overview, Notes, TODOs (checkboxes), Completed (dated)**.
  Update it when you work on a feature, and move finished TODOs to Completed.
- `.memories/bugs/<slug>.md` covers **every bug you find**, including ones fixed immediately. It has
  Overview, Repro, Root cause / Fix, Notes, TODOs and Completed, and a Status line.
- `.memories/general/*.md` holds decisions (`decisions.md`), external API quirks (`api-notes.md`),
  environment notes (`environment.md`) and conventions (`conventions.md`).

Read the relevant memories before starting work on an area, and update them in the same commit as
the code.
