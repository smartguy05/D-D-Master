# Bug: host character editor saves stale HP/AC/gold after server changes
Status: fixed (2026-10-18)
Area: web (host Party tab)

## Overview
`CharacterEditor` copied `hp`, `maxHp`, `ac`, `gold` and `appearance` into local state once, on
mount. When the server changed them while the editor was open (damage, a rest, level-up), the
fields kept the old values, and *Save* (which PATCHes all five together) wrote the stale HP back,
undoing the heal or the level-up HP. Switching *Edit* to another character also reused the state
because the component had no `key`. The new Short/Long rest and Level up buttons made this easy to
hit.

## Repro
Open *Edit* on a damaged PC, click *☀ Long rest*, then *Save*: HP went back to the damaged value.

## Root cause / Fix
`useState(initial)` only reads the prop once. Fix: one `useEffect` per field that resets it when
the server value changes, and `key={editing}` on `<CharacterEditor>` in `PartyTab.tsx`. React
components are not unit-tested in this repo; checked by hand in the browser (smoke run).

## Notes
A host who is mid-typing loses the typed value if the server changes that same field at that
moment. That is acceptable (the server value is newer).

## TODOs

## Completed
- 2026-10-18: Fixed with the rules UI (stream D).
