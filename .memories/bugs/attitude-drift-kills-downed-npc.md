# Bug: adjust_attitude drifting into Hostile killed an Unconscious NPC
Status: fixed (2026-10-20)
Area: server (engine)

## Overview
`adjust_attitude` reuses `applyDisposition`, which carried set_disposition's rule "a knocked-out
ally turned foe is Dead". A gradual social drift (insults, a failed Influence check) on a downed
NPC turned it Dead with no death moment and no hint in the output.

## Repro
Friendly NPC at 0 HP, Unconscious. `adjust_attitude -2` three times (score -3, Hostile): its
conditions became `Dead`.

## Root cause / Fix
The foe-at-0-HP rule lived in the shared helper. Fix: `applyDisposition(..., killDowned = true)`;
`adjust_attitude` passes `false`, so the creature turns hostile but stays Unconscious.
`set_disposition foe` keeps the rule. Tests in `apps/server/src/engine/attitude.test.ts`
("a downed NPC drifting into Hostile stays down").

## Notes

## TODOs

## Completed
- 2026-10-20: killDowned flag, with tests for both tools.
