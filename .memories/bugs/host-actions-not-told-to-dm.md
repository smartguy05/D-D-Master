# Bug: host tool calls are not told to the live DM (it re-spawned the boss)
Status: fixed (2026-10-20)
Area: server (game service)

## Overview
Host actions that go through `POST /api/tools/:name` (Spawn on the Adventure tab, End combat,
rests, level up, Remove monster, Go here, Board edits) change the state, but the running DM is not
told. It only sees them on its next `get_party_status`, which it often skips.

## Repro
Test run 2026-10-19: host clicked *Spawn 1× Ogre, 2× Kobold Warrior*; the DM then narrated the
fight and called `spawn_monster` Ogre + 2 Kobold Warriors itself (events 487–488) → two Ogres and
four boss kobolds. `start_combat` also pulled Tikk's two friendly kobolds into initiative as foes.

## Root cause / Fix
`GameService.runTool(name, args, source)` has no DM notification for `source === "host"` (only the
builder and physical rolls call `notifyDm`). Fix: for host-sourced tool calls while a DM is live,
add a silent system note (no `response.create`) such as "Host did: spawn_monster Ogre ×1, Kobold
Warrior ×2 at the wreck". Keep it out of the spoken reply.

## TODOs
## Completed
- [x] 2026-10-20: Silent host-action note to the DM session; test
- 2026-10-20: game/hostNote.ts hostActionNote + runTool(source host) adds a silent addSystemNote 'Host did: …' when state changed (skips record_physical_roll, edit_fog, playerRoll via noteDm:false). Persona tells the DM not to repeat them. Tests: hostNote.test.ts, service.host-note.test.ts.
