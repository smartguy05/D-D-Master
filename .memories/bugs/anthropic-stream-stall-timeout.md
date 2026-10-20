# Bug: the Anthropic brain timeout doesn't cover a stalled stream
Status: fixed (2026-10-20)
Area: server (brain provider)

## Overview
`BRAIN_TIMEOUT_MS` goes to the Anthropic client, but the SDK clears its timer once response
headers arrive. `AnthropicProvider` streams (`messages.stream` → `finalMessage()`), so a stream
that stalls after the first bytes hangs the job forever. OpenAI uses a non-streaming call and is
covered.

## Repro
Found reading the SDK (0.60) during the 2026-10-20 review; not reproduced live.

## Root cause / Fix
Fix: `withDeadline(stream.finalMessage(), config.brainTimeoutMs, () => stream.abort())`.

## TODOs
## Completed
- [x] 2026-10-20: withDeadline helper + tests; AnthropicProvider uses it
- 2026-10-20: withDeadline around stream.finalMessage() (timeout × (retries + 1), aborts the stream; rejects even if abort throws). Tests: provider.test.ts.
