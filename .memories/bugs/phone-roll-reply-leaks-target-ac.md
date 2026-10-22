# Bug: a phone's roll reply leaked the target's AC, DM hints and the next (hidden) turn
Status: fixed (2026-10-22)
Area: server (routes/player.ts)

## Overview
`POST /api/players/:id/roll` returned the whole `roll_dice` tool result to the phone: `vs_ac` (the
target's exact AC), `hint` ("Call apply_damage on <creature>") and the rest. `/physical-roll`
returned `record_physical_roll`'s result, which can include `next_turn` (the name of the next
creature in initiative, maybe a hidden ambusher), `instruction`, and for damage the target's HP
summary. The phone ignores the reply, but anyone can read it in the network tab, so after online
play phase 2 filtered `/ws` this was the remaining REST leak.

## Repro
As a remote player, attack a creature from the phone pad and read the response body: `vs_ac: 15`.

## Root cause / Fix
The routes returned service results meant for the host. They now pass the result through
`seatRollReply` (publicFeed.ts) for any caller below the host: `{ok, total, dmInformed?}` or
`{ok: false, error}`. The host's own calls still get the full result.

## Notes
- Test: apps/server/src/app.auth.test.ts ("a phone's roll answers players with the total only").
- Other player-reachable REST reads were checked: notes (seat-bound, own text), spells (own
  character), `GET /api/auth/claim` (names only), `/api/status` (host only), `/media` (hashed names;
  the public campaign carries no unvisited map URLs or prompts). See docs/server/state-projection.md.

## TODOs

## Completed
- 2026-10-22: fixed with a test (online play phase 2).
