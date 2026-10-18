# Bug: parallel speak_as_npc calls played in synthesis order
Status: fixed (2026-10-18)
Area: server (realtime)

## Overview
Two `speak_as_npc` calls in one response (run with `Promise.all`) were queued in the order their
TTS finished, so a long first line could play after a short second one.

## Repro
One response with "Guard: First: halt, who goes there?" and "Thief: Second: run!"; the first takes
longer to synthesize. Found by the adversarial review (round 1).

## Root cause / Fix
`speakAsNpc` enqueued after `await synthesize`. Fix: `NpcClipQueue.reserve()` takes the slot
synchronously before synthesis; `slot.play(clip)` fills it, `slot.cancel()` frees it on error, and
an unfilled slot expires after 30 s. The response hold is registered on the slot's `done`.
Test: "parallel calls in one response play in call order" in `npc-voice.test.ts`, and the
reserve tests in `npc-queue.test.ts`.

## TODOs

## Completed
- 2026-10-18: Fixed (review round 1).
