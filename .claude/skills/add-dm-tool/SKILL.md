---
name: add-dm-tool
description: Checklist for adding or changing a DM tool (anything in ToolArgs that the voice DM, brain or host can call). Use whenever a task adds a tool, changes a tool's args or output, or makes a tool host-only.
---

# Add or change a DM tool

## Steps
1. **Args + description**: `packages/shared/src/tools.ts`. Add a zod schema to `ToolArgs` and a line to
   `TOOL_DESCRIPTIONS`. Defaults belong in the schema (`.default(...)`). If the DM must never call it,
   add it to `HOST_ONLY_TOOLS` (it is then left out of the Realtime tool list and refused from source "dm").
2. **Handler**: pick one.
   - Engine tool (pure state change): a handler in `apps/server/src/engine/tools.ts` and its name in
     `ENGINE_TOOLS`. Rules tools go in `apps/server/src/engine/rules/` and are added via `RULES_HANDLERS` / `RULES_TOOLS`.
   - Service tool (I/O, LLM, voice, campaign lifecycle): a `case` in the switch in `GameService.runTool`
     (`apps/server/src/game/service.ts`).
3. **Side effects in `runTool`** (engine tools):
   - If the tool changes the DM's "NPCs here" / "Objects here" / door or feature lists, add it to
     `CREATURE_LIST_TOOLS` or `MAP_OBJECT_TOOLS`, or to the `refreshInstructions()` condition. See
     `.memories/bugs/npcs-here-list-stale.md` and `dm-door-list-stale.md`.
   - If the host can call it, give it a line in `hostActionNote` (`apps/server/src/game/hostNote.ts`)
     so the live DM hears "Host did: …". Service tools don't pass through that branch: notify the
     DM yourself (`.memories/bugs/host-end-campaign-dm-unaware.md`).
4. **Tests first**: arg parsing in `packages/shared/src/tools.test.ts`; behaviour in
   `apps/server/src/engine/*.test.ts` through `executeEngineTool`, or in `service.<area>.test.ts`.
5. **Docs**: `docs/reference/tool-catalog.md`. Add a line to `apps/server/src/realtime/instructions.ts` only if
   the DM should use the tool unprompted. Keep it to one short line, because the persona is resent on every
   `session.update`. Run `instructions.test.ts`.
6. Finish with the `finish-change` skill (docs front matter, memories, `docs_index.py check`).

## Gotchas (each one has bitten before)
- **Errors must tell the model what to do.** Both styles are in use:
  - `throw new Error("…")` aborts the whole call with nothing committed. The session turns it into
    `{ error }` and logs it under `[tool]`. Use this for invalid calls.
  - `return { error: "…" }` keeps the cloned state but skips the turn-economy spend (`isErrorOutput`).
    Use this for refusals that should still leave a trace in the output.

  Either way, the message is a hint the model can act on, e.g. "no such door; doors here: …".
- `awayRefusal` and `economyGate` run **before** your handler. A tool naming an away PC, or
  going over a creature's turn budget, never reaches it. New action types need a budget rule in
  `engine/economy.ts`. See `.memories/bugs/turn-limits-not-enforced.md` and `spell-attack-refused-after-cast.md`.
- **Steer the model with the output.** Use fields like `instruction`, `note`, `foes_standing` and `passed`.
  The DM obeys tool results more reliably than persona prose (the `fix-dm-behavior` skill).
- Enforce rules in the handler, not in the description: `end_combat` refuses victory while
  `foesStanding` is non-empty, `roll_dice` rejects an unknown roller, and `pick_up` refuses an empty take.
- Repeated calls happen. Dedupe where a double call is harmful, e.g. `record_physical_roll` within
  10 s returns `already_recorded`.
- Engine handlers mutate the cloned `next` state only, and have no clock and no I/O. Long async follow-ups
  (sprites, icons, maps) start from `runTool` and must re-check the campaign id after each `await`.
- New state fields: add them with `.default(...)` in `packages/shared/src/schemas.ts` and update
  `docs/reference/game-state.md`.
