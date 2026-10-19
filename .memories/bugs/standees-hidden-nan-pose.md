# Bug: token standees (sprites) missing from the TV board
Status: fixed (2026-10-18)
Area: web (/table MapBoard)

## Overview
On the 3D board every token showed only its base ring: no sprite, no initials fallback, no HP bar.
PCs and monsters alike (a monster reappeared only for the length of a hit reaction). The sidebar
cards showed the sprites fine, so it looked like "player sprites not rendering".

## Repro
Open /table with any token on the board that has not just been hit.

## Root cause / Fix
Since the attack animations (b4ca27b), `TokenMesh`'s frame loop set the standee group's
`position.x = Math.sin(age * 0.09) * shake * k`. With no reaction, `age = Infinity`, so
`Math.sin(Infinity)` is NaN and `NaN * 0` is NaN; three.js drops an object with a NaN matrix.
Fix: the pose is now `reactionPose(kind, age)` in `apps/web/src/table/effectPlan.ts`, which returns
a finite zero pose outside the reaction window. Tested in `effectPlan.test.ts`; checked in the
browser (standees and HP bars back).

## Notes
Unit tests covered the effect plans but not the per-frame math in the component. Keep frame-loop
math in pure helpers so it can be tested.

## TODOs

## Completed
- 2026-10-18: Fixed with reactionPose.
