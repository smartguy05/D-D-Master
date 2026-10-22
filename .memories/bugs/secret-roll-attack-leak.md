# Bug: a secret attack roll still told players it was an attack, its target and cover
Status: fixed (2026-10-22)
Area: shared (projection.ts)

## Overview
Found reviewing the phase B fixes (follow-up to secret-roll-label-leak.md). `redactSecret` dropped
the label, modifier, dc and success but kept `attack`, `targetId` and `cover`. A hidden sniper's
secret shot at a PC reached players as `{secret:true, attack:true, targetId:"pc-mara", cover:"half"}`.

## Repro
`publicRoll(roll({ secret: true, attack: true, targetId: "pc", cover: "half" }), state)`.

## Root cause / Fix
`redactSecret` also removes `targetId` and `cover` and sets `attack: false`; only the dice sides and
the roller remain. Test: projection.test.ts "a secret attack roll doesn't say it was an attack, whom
it targeted or their cover".

## Notes
- Host and TV (full tier) are unchanged; critical inference runs on the server's copy.

## TODOs

## Completed
- 2026-10-22: fixed with tests.
