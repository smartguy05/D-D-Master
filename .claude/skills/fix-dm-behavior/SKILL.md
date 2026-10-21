---
name: fix-dm-behavior
description: How to fix the voice DM (OpenAI Realtime) when it narrates instead of calling a tool, stalls mid-turn, breaks a rule, repeats a call, or ignores the engine. Use for any "the DM did X wrong in play" bug, test-run log review, or persona tuning in realtime/instructions.ts.
---

# Fix DM (model) behaviour

A persona line alone has never been enough. Every fix that held used **three layers**, strongest first.

## 1. Engine: enforce the rule, or apply the default
- Refuse bad calls with a useful error, e.g. `end_combat` while `foesStanding` is non-empty
  (`.memories/bugs/victory-with-foe-standing.md`), or `gateMove` / `economyGate` in
  `apps/server/src/engine/economy.ts` (`turn-limits-not-enforced.md`).
- Don't wait for the model to make a "setup" call. Apply the default yourself: fog turns on at the first
  `change_scene` (`fog-never-enabled.md`), the target's AC becomes the default DC (`attack-hit-not-checked-against-ac.md`),
  and routed movement with `planMove`/`findPath` (`move-narrated-through-wall.md`).
- Put the next step in the tool output (`instruction`, `note`, `passed`, `campaign_ended`).

## 2. Session: nudge or cap
`apps/server/src/realtime/session.ts`. The session continues on its own **only after function calls**:
a reply that is only speech, or an empty one, ends the loop unless a nudge fires.
- `nudgeStalledTurn` / `stalledTurn` handles a monster or player turn that was left hanging
  (`dm-stalls-on-monster-turn.md`, `dm-stalls-mid-player-turn.md`).
- `nudgeEmptyFollowUp` handles an empty reply after tool output.
- `MAX_MOVES_PER_REPLY` stops the DM hunting cells one by one (`dm-hunts-cells-around-lever.md`).
- Add a new nudge or cap with a test in `session.test.ts`. Check that it can't make the DM repeat itself.

## 3. Persona: one short line
`apps/server/src/realtime/instructions.ts`. Keep it short, because it is resent on every `session.update`.
`instructions.test.ts` pins key strings; update it. If the instruction contradicts a
`TOOL_DESCRIPTIONS` entry, fix the description instead.

## Investigating
- **Event log**: every tool call is stored with `appendEvent`. Export the campaign and cite event numbers
  in the bug memory, e.g. "events 343/344, cmp_fc62fc3580".
- **Server log tags** to grep: `[tool]` (tool errors only), `[moves]`, `[stall]`, `[turn-timing]`,
  `[handover]`, `[ai]`, `[echo]`, `[roster]`. On the `/table` browser console, look for `[voice]`.
  The full table of tags is in `.memories/general/live-test-checklist.md`.
- Reproduce without voice by calling `GameService.runTool` in a test, or `POST /api/tools/<name>`
  against a `seed:demo` server (the `run-and-screenshot` skill).
- Fault injection has worked before: a hanging API call, dropping the socket before a tool resolves,
  or `close()` before `open`.

## Related invariants
- Never `send()` on a closed Realtime socket. Set the `wantResponse` flag and let the outbox flush
  (`blind-response-after-drop.md`, `gate-timeout-lost-during-reconnect.md`).
- Ignore events from a superseded socket or session (`stale-dm-offline-status.md`).
- Every external call needs `withDeadline` plus an abort (`ai-player-goes-mute.md`, `brain-calls-slow-no-timeout.md`).
- Record the bug in `.memories/bugs/<slug>.md`. A live re-test goes in `.memories/general/live-test-checklist.md`.
