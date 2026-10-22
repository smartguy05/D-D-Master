# Bug: Host can't unassign a character from a player
Status: fixed (2026-10-22)
Area: web, server

## Overview
Picking **— no character —** for a player on the host Party tab did nothing, so a player couldn't
drop their hero and build a new one on their phone.

## Repro
Assign a character to a player, then pick "— no character —" in that player's dropdown. The player
keeps the character.

## Root cause / Fix
- `PartyTab.tsx` sent `{ characterId: undefined }`; `JSON.stringify` drops it, so the PATCH body was
  `{}`. It now sends `null`, and `GameService.updatePlayer` treats `characterId: null` as unassign
  (deletes the field; clears the old character's `playerName` unless another seat plays it).
- Phone side: a `joined` draft still pointed at the old character, so building again would have
  edited it and its roster entry. `CreationFlow.get` now returns a fresh draft when the seat no longer
  plays the draft's character, and `useCreation` refetches when the seat's character id changes.
- Test: `service.creation.test.ts` "the host unassigns a phone-made hero…".

## Notes
JSON bodies can't carry `undefined`; use `null` to clear a field over the API.

## TODOs
## Completed
- 2026-10-22: Fixed as above.
