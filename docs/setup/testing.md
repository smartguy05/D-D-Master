---
title: Testing
area: setup
topic: testing
related_code:
  - vitest.config.ts
  - "**/*.test.ts"
  - apps/server/src/scripts/eval-voiceid.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version (51 tests)"
---

# Testing

The project follows a test-first rule: every engine, parsing or matching change comes with a
Vitest test.

```bash
pnpm test            # all unit tests (vitest, root config)
pnpm typecheck       # tsc for shared, server and web
pnpm docs:check      # docs audit + index freshness
```

| Suite | File | Covers |
|---|---|---|
| Dice notation | `packages/shared/src/dice.test.ts` | Parsing, keep-high/low, bounds |
| Tool schemas | `packages/shared/src/tools.test.ts` | Every tool exported as a JSON-schema function with required args |
| Engine | `apps/server/src/engine/tools.test.ts` | HP, temp HP, conditions, items, gold, rolls, spawns, initiative, scenes, tokens |
| Rules and SRD | `apps/server/src/rules/rules.test.ts` | Chunking, lookups and stat-block parsing against the real SRD |
| Voiceprints | `apps/server/src/speaker/voiceprint.test.ts` | Matching, ambiguity, running mean, ring buffer, silence trim |
| Realtime loop | `apps/server/src/realtime/session.test.ts` | Speaker note before `response.create`, parallel tool calls and outputs, error passthrough, response queueing, transcripts |
| Brain JSON | `apps/server/src/brain/provider.test.ts` | JSON extraction and the one-retry repair loop |
| 3D dice | `apps/web/src/dice/dice.test.ts` | Geometry, d10 planarity, **every value lands up after physics**, d100 mapping |

## Integration checks

- **Voice-ID accuracy**: `bash scripts/download-models.sh --with-tts`, then
  `pnpm --filter @dm/server eval:voiceid`. This enrolls 6 synthetic voices from one sentence each
  and identifies 30 new sentences. Result on 2026-09-24: 30/30.
- **Visual check**: seed the demo, then `pnpm build && pnpm start`. Open `/table`, and from `/host`
  roll `1d20+1d12+1d10+1d8+1d6+1d4+5`. You should see dice fly and settle, then a toast whose total
  matches. Headless Chromium works with `--use-angle=swiftshader`.
- **Live voice** (needs a key and a human): enroll 2–3 voices, start the voice DM, talk without
  saying names, and interrupt the DM mid-sentence. Then roll an attack (virtual and physical), take
  damage, pick up an item, end the session, restart, and resume to hear the recap.
