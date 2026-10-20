# Bug: brain calls are slow and have no timeout
Status: fixed (2026-10-20)
Area: server (brain provider)

## Overview
*Write adventure* (one-shot) took ~6 minutes and *AI pregens* (2) ~2–3 minutes with
`BRAIN_MODEL_OPENAI=gpt-6.1-sol`. The host only sees an hourglass job; a hung call would sit for a
long time.

## Repro
Test run 2026-10-19, Adventure tab → Write adventure; Party tab → Generate pregens.

## Root cause / Fix
`OpenAIProvider.complete` (`brain/provider.ts`) passes no `timeout`, no reasoning effort and uses
the SDK defaults (10 min per attempt, 2 retries). Ideas: a configurable timeout and reasoning effort
in `config.ts`/`.env.example`; show elapsed time on the job chip; paint the next location's map in
the background so arrival doesn't wait on it.

## TODOs
## Completed
- [x] 2026-10-20: BRAIN_TIMEOUT_MS / reasoning effort config; elapsed time on job chips
- 2026-10-20: BRAIN_TIMEOUT_MS (default 5 min, one retry; 0 = no limit) and BRAIN_REASONING_EFFORT; job events carry startedAt and host chips show elapsed m:ss; next map prepainted (PREPAINT_MAPS). Tests: config.test.ts, provider.test.ts, service.jobs.test.ts, service.prepaint.test.ts, lib/elapsed.test.ts.
