# Bug: a fog-off location sent the host's hidden cell list to players
Status: fixed (2026-10-22)
Area: shared (projection.ts)

## Overview
Found reviewing the phase B fixes. `publicFog` stripped `hidden` only for fog-on entries. `set_fog`
disable only flips `enabled`, so a location whose secret room was hidden with `edit_fog` and then had
fog turned off sent the exact secret cells in every player's `state.fog[loc].hidden`.

## Repro
`fog.shop = { enabled: false, revealed: [], hidden: ["4,4"] }`: `publicState(s).fog.shop.hidden`
was `["4,4"]`.

## Root cause / Fix
`publicFog` returns `{ ...f, hidden: [] }` for fog-off entries too. Test: projection.test.ts "fog
goes out as the party sees it ... (fog off too)".

## Notes

## TODOs

## Completed
- 2026-10-22: fixed with tests.
