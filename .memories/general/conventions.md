# Conventions

- Tests first for engine, parsing and matching logic (Vitest, `*.test.ts` next to the code).
- All game mutations go through `GameService.runTool` or explicit service methods → `commit()`.
  Never mutate `game.state` in place from routes.
- Engine handlers are pure over a cloned state; return small model-friendly outputs.
- New GameState/Character fields: add them with `.default(...)` so old saves still parse.
- Tool changes: update ToolArgs + TOOL_DESCRIPTIONS + handler + test + docs/reference/tool-catalog.md.
- Model names only in config/.env, never hard-coded elsewhere.
- Keep the DM persona short; it is resent on every session.update.
- Docs: update related docs and memories in the same change; run
  `python3 scripts/docs_index.py rebuild && python3 scripts/docs_index.py check`.
