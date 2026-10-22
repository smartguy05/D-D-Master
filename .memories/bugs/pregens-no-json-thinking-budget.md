# Bug: "Brain returned invalid Pregens: No JSON found in model output"
Status: fixed (2026-10-21); small-cap callers still at risk (see TODOs)
Area: server (brain/provider.ts)

## Overview
Generating pregenerated characters on /host failed with "Creating pregenerated characters: Brain
returned invalid Pregens: No JSON found in model output". Brain was `anthropic:claude-sonnet-5-5`.

## Repro
BRAIN_PROVIDER=anthropic with a current Claude model, generate 4+ pregens for a campaign. Intermittent:
a direct test call with 4 characters used 6.7k output tokens and returned a thinking block + 8.7k chars of JSON.

## Root cause / Fix
- Current Claude models always think (Sonnet 5.5 rejects `thinking: disabled`), and thinking tokens count
  toward `max_tokens`. The Anthropic provider defaulted to 16000, so a long JSON reply could stop at
  `max_tokens` with only a thinking block — empty text — which `extractJson` reported as "No JSON found".
  The repair retry hit the same cap.
- Fix: Anthropic default `max_tokens` 64000 (it streams, so no HTTP timeout), and `anthropicReplyText`
  throws "hit its N-token limit" on `stop_reason: "max_tokens"` instead of passing on empty/partial text.

## Notes
- The server log never shows the raw reply or stop reason; the diagnosis came from a direct call.

## TODOs
- [ ] consult (4000), summaries (4000) and the AI player (2000) pass small `maxTokens`; on Anthropic,
      thinking can eat those too. Consider `output_config.effort: "low"` for those routes.

## Completed
- 2026-10-21: max_tokens default raised, max_tokens stop surfaced as a clear error, tests in provider.test.ts.
