# Bug: The party "went down the hatch" but the scene never changed (host advanced by hand)
Status: fixed (2026-10-21), live re-test pending
Area: server (engine, realtime session, persona)

## Overview
cmp_04ee010393, 19:53:34: Brannoc said "We enter the hatch and go down into the cellar". The DM
narrated the cellar and footprints "toward the graveyard beyond", asked "Where do you go from
here?" and never called `change_scene`. The host advanced to loc_graves at 19:54:08 (host
`change_scene` event). The other transitions worked as designed: the first `change_scene` was refused for the ready check, and
the second call went through.

## Root cause / Fix
Exit features (`kind: "exit"`) are not linked to any location, and nothing noticed the party
leaving. Fix:
- `exitNear` / `nextLocation` (packages/shared/src/features.ts). A PC that `move_party` or
  `move_token` puts on or beside an exit gets a `hint`: "the way on to <next outline location>…
  call change_scene <id> now".
- The board watcher sends a `travel` nudge naming `change_scene <id>` when the text names another
  outline location (watch.test.ts uses this exact exchange).
- Persona: going on through the way out *is* leaving, so start the ready check right away instead of
  asking where they go.

## Notes
- "Next location" means outline order. A non-linear outline may point the hint at the wrong place.
  The hint is advice, and the DM picks the id.

## TODOs
- [ ] Live: walking to an exit triggers the ready check without host help.

## Completed
- 2026-10-21: exit hint, travel nudge, persona line, tests (engine/move-party.test.ts).
