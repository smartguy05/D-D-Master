# Bug: generated NPC voices changed on add_npc and collided often
Status: fixed (2026-10-20)
Area: shared (attitude.ts), server (engine add_npc)

## Overview
1. `speak_as_npc` falls back to `defaultNpcVoice(name)`, but `add_npc` stored
   `defaultNpcVoice(name, appearance, "humanoid")`: a different hash key, so an NPC that spoke before
   it was placed got a different voice afterwards ("humanoid" was also hard-coded).
2. `defaultNpcVoice` picked each component with `Math.imul(h ^ salt, odd) % len`. An odd multiplier
   keeps the low bits, so both 8-entry lists (pitch, pace) followed `h & 7` and the 10-entry lists
   shared parity: about 200 of 6400 combinations were reachable, and "Tikk" and "Dorn" collided.

## Repro
1. `speak_as_npc {npc_name:'Old Tam'}`, then `add_npc {name:'Old Tam', appearance:'stooped fisherman'}`:
   the stored voice differs from the first one.
2. 3000 names gave only 8 of 64 pitch|pace pairs.

## Root cause / Fix
1. `add_npc` now stores `defaultNpcVoice(name)` (name only), matching the fallback.
2. Each component uses `mix32(h ^ salt)` (murmur3 finalizer) before the modulo.
Tests: `packages/shared/src/attitude.test.ts` (all 64 pairs, >2000 distinct of 3000) and
`apps/server/src/engine/npcs.test.ts` (add_npc default equals `defaultNpcVoice(name)`).

## Notes
- Generated voices for saved NPCs that already store a `voice` are unchanged; only new defaults differ.

## TODOs

## Completed
- 2026-10-20: name-only default in add_npc; independently mixed components.
