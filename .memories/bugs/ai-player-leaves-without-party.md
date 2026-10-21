# Bug: An AI player's "let's go" moved the whole party to the next area
Status: fixed (2026-10-21)
Area: server (game service, DM persona, AI players)

## Overview
Playing with an AI seat, the AI decided to leave the area to continue. The human player was not
ready, but the DM called `change_scene` straight away and the party moved to the next location.

## Repro
Party with one human and one AI seat at a location. The AI says "Let's head on to the next room."
The DM treats it as the party's decision and calls `change_scene` (whole party) with no question
to the human.

## Root cause / Fix
Nothing required the DM to check with the others: the persona only said "change_scene when the
party travels", and the AI prompt didn't stop the AI deciding for the party. Fix:
- `game/readyCheck.ts` `departureGate`, run by `GameService.runTool` for DM `change_scene`: if a
  human player's character in the focused scene would leave, the first call is refused with
  `{error, ask}` naming them. A repeat to the same location passes once a human said anything
  after the refusal (`humanInputs`: voice turns + typed lines not from an AI seat).
- Skipped for the first arrival, AI-only movers, host calls, and `forced: true` (new ToolArgs field:
  trapdoor, teleport trap).
- Persona: ask everyone going by name and wait; an AI suggestion isn't the party's decision.
- AI player prompt: never decide for the party to leave; suggest it and ask.

Tests: `game/readyCheck.test.ts`; `service.split.test.ts` now passes `forced` for DM splits.

## Notes
The gate counts any human line, not a "yes": the DM judges the answer. A "no" followed by the DM
calling again would pass, so the persona says to stay if someone isn't ready.

## TODOs
- [ ] Live check: the DM asks before leaving and doesn't reach for forced=true to dodge the check. (see general/live-test-checklist.md)

## Completed
- 2026-10-21: Fixed with tests.
