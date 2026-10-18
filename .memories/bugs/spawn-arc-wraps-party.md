# Bug: Large spawn arcs wrap around the party; formations fragment near the party
Status: fixed (2026-10-18)
Area: server

## Overview
`spawn_monster {formation: "arc", count: 12}` with the party ~7 cells from the altar used an arc
radius of 6 from the altar's edge, so the flanks curled around the party and the group's centre
sat nearer the party than the altar. A cluster or line anchored next to the party was cut into
pieces by the 3-cell distance rule.

## Repro
Party at (2,6),(2,7); blocking focal altar at x 9-10, y 5-6 on a 20x12 grid; `planSpawn(..., 12,
{formation: "arc"})`. Line: same party, `anchor: {x: 3}`, `formation: "line"`.

## Root cause / Fix
The arc radius ignored the distance to the party, and the anchor was never moved off the party.
Fix (`engine/spawn.ts`): cap the arc radius at min(gap/2, gap - 3) (min 1), add ranks behind the
front rank, push cells > 90 degrees off the facing last; walk point anchors away from the party
centroid until they clear MIN_PC_DISTANCE. Also in this round: `near` "door" picked "Trapdoor"
(list order) before "Front door": a whole-word step now sits between prefix and contains.

## Notes
- Found by the stream E adversarial review, round 1. Tests in `engine/spawn.test.ts`
  ("formations near the party", "findFeature precedence").

## TODOs

## Completed
- 2026-10-18: fixed.
