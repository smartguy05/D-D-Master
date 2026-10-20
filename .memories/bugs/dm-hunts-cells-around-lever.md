# Bug: the DM moves a token all over the board, then gives up
Status: fixed (2026-10-19)
Area: server (engine move_token, realtime session, persona)

## Overview
Sylvaine said "I set the wheels to seed, vine, then pumpkin and pull the lever". The DM made about 80
`move_token` calls in roughly 60 seconds (events 232–313, campaign cmp_fc62fc3580, loc_cistern),
jumping the token around the wheels. It then said "It's tricky maneuvering around these wheels and
obstacles… let me know exactly where you'd like to stand", and the puzzle never got resolved.

## Repro
Moonwheel Cistern map: three wheels and the "Sluice operating lever" are all `blocks: true`. Together
they fill x 11–18, y 6–8. Ask the DM to pull the lever.

## Root cause / Fix
The DM tried to stand the token *on* the lever. `move_token` correctly redirected it to the nearest
free cell, returning `redirected: true, reason: "… blocks that cell"`. The model read that as a failure
and tried another cell inside the blocked block, again and again. `onResponseDone` chains tool rounds
with no limit, so nothing stopped it.
Fix, in three layers:
- Engine: the redirect result adds a `note`. If the token ended up next to the blocker, the note says
  it is close enough to use it. Either way the note says to leave the token there.
- Session: `MAX_MOVES_PER_REPLY` (2) `move_token` calls per entity per reply. Later calls return an
  error without running. The count resets when the reply ends or on `next_turn`.
- Persona: furniture is used from beside it. Move once and accept the redirect; no move is needed if
  the character is already near.
Tests: `spawn.test.ts` (redirect note) and `session.test.ts` ("move cap per reply").

## Notes
- Generated maps often make interactive objects (levers, wheels) `blocks: true`. That is correct for
  standing, but the DM doesn't know the object is "used from beside it" unless we tell it.
- The DM also didn't need to move at all for "pull the lever". The persona line covers that too.
- 2026-10-20 (Phase 3): the "DM doesn't know the object is used from beside it" root is now
  addressed at the source. The vision read (`readMapFeatures`) marks levers, switches, chests,
  altars, wheels and doors `interactive: true` (`MapFeature.interactive`, default false), the DM's
  feature list tags them `(…, interactive)` (`describeFeatures`), and the persona says interactive
  features are used from beside them with no hunting for cells. `place_interactable` covers usable
  things the map doesn't show.

## TODOs
- [ ] Live test: ask the DM to use a blocking object and check it makes at most one move, then
  resolves the action.

## Completed
- 2026-10-19: redirect note, per-reply move cap, persona line.
- 2026-10-20: interactive map features (vision flag, `interactive` tag in the DM's feature list,
  persona line), as part of loot and interactables.
- 2026-10-20: the host can tick a feature "interactive" in the Board tab, and the TV draws an aura on
  interactive features, so the table sees what can be used too.
