# Bug: blind response.create after a drop that lost a function_call_output
Status: fixed (2026-10-18)
Area: server (realtime)

## Overview
Regression from the round-1 fix (c154370). If the sideband dropped while `runTool` was awaiting
(slow `consult_brain`, NPC TTS), the tool's `function_call_output` was sent to the closed socket
and dropped. On reconnect the pending `wantResponse` was drained, so the model got a
`response.create` with an unanswered function call and could re-issue it (double damage).

## Repro
Voice DM; a `response.done` with an `apply_damage` call; drop the socket before the tool resolves;
reconnect. Found by the adversarial review (round 2).

## Root cause / Fix
`send()` silently discarded everything while the socket wasn't OPEN. Fix: `send()` buffers
`conversation.item.create` / `conversation.item.delete` in an outbox (max `OUTBOX_MAX` = 100,
oldest dropped with a warning) and the `open` handler flushes it in order before draining
`wantResponse`. `response.create` is not buffered (it stays the `wantResponse` flag). Text mode
drops buffered `function_call_output`s on reconnect (new conversation). Same round: frames after
`close()` are ignored, and `speaking` is reset on reconnect. Tests in `session.test.ts`
("a function_call_output produced while disconnected…", "text mode drops buffered…",
"caps the outbox…", "ignores frames that arrive after close()", "a reconnect clears a stuck
'speaking'").

## TODOs

## Completed
- 2026-10-18: Fixed (review round 2).
