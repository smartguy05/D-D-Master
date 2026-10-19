# Bug: attack swing plays before the damage dice
Status: fixed (2026-10-19)
Area: web (/table)

## Overview
On the TV the attack swing/arrow/orb sometimes played while (or before) the damage dice rolled,
so the hit landed before the table saw how much damage it did.

## Repro
Attack roll with a `target_id` that hits, then a damage roll and `apply_damage` with `source_id`.
The `attack` effect arrives with the d20 roll and played at once; the dice tray then showed the
d20 and the damage dice after it.

## Root cause / Fix
Two independent queues: `TablePage.onEffect` stamped `receivedAt` on arrival while the dice tray
works through `queue`/`current`. Fix: `effectPlan.releaseHeld` (pure, tested) holds effects
while dice roll; a hit/crit attack also waits `DAMAGE_GRACE_MS` after the tray goes idle for its
damage roll (or releases with its matching `hit` effect, which the travel dedupe merges into one
swing). Misses release after the d20. `onRoll` marks the tray busy synchronously, since the roll's
effect arrives in the same tick before React commits the queue.

## Notes
- The grace starts when the tray goes idle (4 s after settle), so the DM has ~7 s from the d20
  landing to start the damage roll.
- Check timing on the real TV with the voice DM (TODO.md live tests).

## TODOs
- [ ] Live check: DM voice latency between the attack and damage rolls vs the grace

## Completed
- 2026-10-19: releaseHeld + TablePage wiring, tests in effectPlan.test.ts
