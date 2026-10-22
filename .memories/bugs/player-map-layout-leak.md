# Bug: player payloads mapped out unexplored rooms (features, walls/doors, host-hidden fog cells)
Status: fixed (2026-10-22)
Area: shared (projection.ts, visibility.ts), web (table/doors.ts, player/playerMap.ts)

## Overview
Found in the online-play review (PR #1, phase B). The player-tier projection only dropped
*interactive* features in unseen cells; plain features (the focal lair, exits, named landmarks)
anywhere on a visited map still went to players. Location walls and `wallEdits` went out whole, so
doors in unexplored rooms reached the browser (the TV and phone map hid them only at render time
with `doorVisible`). Fog went out as stored, so `LocationFog.hidden`, the cells the host
deliberately re-hid, was a map of secret areas in the network tab.

## Repro
Fogged crypt with a focal "Bone throne" and a door deep in unexplored fog, and `edit_fog` hiding a
revealed cell. Open `/player/:id`, read the `campaign`/`state` frames: the throne, the door segment
and the hidden cell keys are all there.

## Root cause / Fix
`publicFeatures` used `interactiveFeatureShownOnTable` and let every plain feature through;
`publicState` copied `fog` and `wallEdits` and `publicCampaign` copied `walls`. Now:
- `featureShownOnTable` (visibility.ts) = any feature with a visible cell; `interactiveFeatureShownOnTable`
  is built on it. `publicFeatures` keeps only shown features (campaign locations and featureEdits).
- `doorVisible` moved to `@dm/shared` visibility.ts (doors.ts re-exports it; playerMap imports it
  from shared). `publicWalls` keeps segments with a revealed cell on either side when that
  location's fog is on (campaign walls and wallEdits).
- `publicFog`: a fog-on entry becomes `{ enabled, revealed: [...revealedSet(f)], hidden: [] }`.
Tests: projection.test.ts (feature edits, fog, wall edits, publicCampaign), visibility.test.ts
(featureShownOnTable, doorVisible).

## Notes
- Checked before filtering walls: no client code reads walls except the door drawing (MapBoard
  `Doors`, playerMap `doors`); line of sight, light (`litFeatureCells`) and pathing run on the server.
- Fog off at a location: every feature and wall is sent (the whole map is visible anyway).

## TODOs

## Completed
- 2026-10-22: fixed with tests (online play review, phase B1).
