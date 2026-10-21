# Feature: Party split
Status: done (vertical slice)
Docs: docs/gameplay/party-split.md, docs/reference/tool-catalog.md, docs/web/player-view.md, docs/web/host-ui.md

## Overview
The party can split across locations. The TV shows the scene in focus; the DM cuts between groups
with `focus_scene` (host: Focus button). Each group fights its own battles; an unfocused fight is
frozen. Phones show a view-only map of their character's own location.

## Notes
- Model: top-level scene = focus; `GameState.scenes` (SceneStash) parks other groups;
  `partyLocations` lists only away PCs (decisions.md, 2026-10-20). Read helpers in
  `packages/shared/src/scenes.ts`, engine side in `apps/server/src/engine/scenes.ts`.
- `inScene`/`mapScene` run focused-scene code on a parked group (leaveInitiative, restaging after a
  paint). `normalizeScenes` in `commit()` prunes empty scenes and stray location entries.
- `awayRefusal` guard runs before the economy gate. Without it `move_token` would create an away
  PC a token on the focused map.
- Present-only: start/end_combat, placement, partyDown, dyingCharacters, rest defaults, timed
  condition expiry. The death rule still counts every PC.
- A `focus_scene` from the host gets its own DM note (the monster diff would be noise).

## TODOs
- [ ] Manual check on a real table: TV transition on focus switch (boardHold/syncBoard with a full
      token swap), phone map legibility on large grids. (see general/live-test-checklist.md)
- [ ] A physical roll pending in a parked scene can only be entered after focusing back; consider
      letting the phone queue it.
- [ ] Optional: prepaint every group's location while split (prepaintAfter follows the focus only).
- [ ] Optional: host Board editing of a parked scene without focusing it.

## Completed
- 2026-10-20: change_scene character_ids (moveGroup), focus_scene, frozen fights, refusals for away
  PCs, OTHER GROUPS in the DM instructions, host Party & spotlight card, TV other-groups line and
  away tags, phone PlayerMap + paused-fight note; tests (shared, engine, service, web helpers).
