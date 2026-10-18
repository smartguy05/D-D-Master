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
`useState(initial)` only reads the prop once. First fix: one `useEffect` per field that reset it on
every server change, plus `key={editing}` on `<CharacterEditor>` in `PartyTab.tsx`.
Review round 1 found that this overwrote a typed, unsaved value. Final fix: dirty tracking in
`apps/web/src/host/editFields.ts` (`{value, base}` per field; `syncEditField`, `editHint`,
`savedField`, tested in `editFields.test.ts`). Clean fields follow the server. Dirty fields keep the
typed value and show "changed on server: N". *Save* PATCHes only dirty fields. Checked in the
browser: typed HP 4 kept with the hint after damage, untouched gold followed a server change.

## TODOs

## Completed
- 2026-10-18: Fixed with the rules UI (stream D).
- 2026-10-18: Review round 1: dirty tracking instead of overwrite-on-change.
