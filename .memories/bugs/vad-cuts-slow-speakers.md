# Bug: The DM answered players who paused mid-sentence
Status: fixed (2026-10-21), live re-test pending
Area: server (realtime session, config)

## Overview
In the 2026-10-21 play-test, half sentences were committed and answered as turns ("I steal", then "I
steal all of Alex's gold", "Gordon.", "Mi", "1"). Because `interrupt_response: false`, the player
could not talk over the reply, so it felt like being cut off.

## Root cause / Fix
`sessionConfig` hard-coded `semantic_vad` with `eagerness: "auto"`. Fix: `REALTIME_VAD_EAGERNESS`
(`config.vadEagerness`, default `low`, config.test.ts), used in `sessionConfig` (session.test.ts pins
`eagerness: "low"`). New diagnostics: `gap=<ms>` on `[turn-timing]` and a `[cutoff]` line when speech
starts within 1.5 s of the DM starting to answer a voice turn.

## Notes
- `low` adds latency to every turn. If replies feel slow, try `medium` and compare `[cutoff]`
  counts with `scripts/session_log.py --only diag`.
- The noise gate stays as it is: dice totals need short turns.

## TODOs
- [ ] Live: a slow speaker who pauses mid-sentence is not answered early. Check latency is acceptable.
- [ ] Maybe: a host toggle to change eagerness live (`session.update`) without a restart.

## Completed
- 2026-10-21: env setting (default low) + diagnostics.
