---
title: 3D physics dice
area: web
topic: dice
related_code:
  - apps/web/src/dice/**
  - packages/shared/src/dice.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version; playback clock cap relaxed to 0.25 s for low-FPS displays"
---

# 3D physics dice

The server decides every result with a crypto RNG. The table then throws **real physics dice**
whose top faces always show that result.

## How the result is enforced (`simulate.ts`)

1. `toVisualDice(roll.dice)` maps each server die to a visual die:
   - d4, d6, d8, d10, d12 and d20 map directly.
   - **d100** becomes a percentile d10 (00–90) plus a ones d10 (0–9), with 00 + 0 = 100.
   - d2, d3 and other sizes have no 3D model and appear only in the toast.
   - At most 12 dice are thrown.
2. `simulateThrow` builds an **offline** cannon-es world: a floor, four walls
   (`TRAY.halfW=9, halfD=5`), and gravity of −40. Dice are thrown from the left with random spin.
3. The world is stepped at 60 Hz, recording position and quaternion every frame. It stops when every
   body has been asleep or nearly still for 12 frames, with a maximum of 6 seconds.
4. For each die, `topIndex` finds the face whose world normal points most upward. For a d4 it finds
   the highest vertex.
5. `forceLabel` **swaps labels** so the required value sits on that face. Because labels are only
   textures, the motion stays real physics.

`DiceTray.tsx` replays the recorded frames in a transparent overlay canvas with shadows, then calls
`onSettled`. The clock advances by `min(dt, 0.25)`, so slow displays still finish on time.

## Geometry (`shapes.ts`)

- d6, d8, d12 and d20 come from three.js polyhedra. Coplanar triangles are merged into polygon faces
  (d12 pentagons, d6 squares), with CCW outward winding.
- The **d10** is a hand-built pentagonal trapezohedron. Its kites are planar because
  `ringY = h(1−cos36°)/(1+cos36°)`, which is tested.
- The **d4** uses real vertex numbering: each face prints the numbers of its three corners, rotated
  so the number pointing up is the result.
- Default labels put opposite faces summing to n+1 where a true opposite face exists. 6 and 9 get
  underlines.
- Each face gets its own UV square and a `CanvasTexture` material (a clearcoat
  `MeshPhysicalMaterial`), colored with the roller's character color, or dark red for the DM.
  Dropped dice (advantage and disadvantage) are grey.

## Tests (`dice.test.ts`)

- Face and label counts for every die.
- The d10 kites are planar.
- **Every value on every die type lands on top after simulation.**
- d100 mapping.
- An 8-dice throw where every die shows its target.
