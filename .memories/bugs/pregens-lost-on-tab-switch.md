# Bug: AI pregens are lost when the host switches tabs while they generate
Status: fixed (2026-10-20)
Area: web (host Party tab)

## Overview
*AI pregens* → *Generate* takes 2–3 minutes. If the host opens another tab meanwhile, the result is
thrown away: back on Party the panel is reset to *Build one* and no pregens are listed. The paid
brain call is wasted. The *Import a sheet* textarea and the *Build one* form lose their drafts the
same way.

## Repro
Test run 2026-10-19 (campaign "Claude Test Run"): Party → AI pregens, count 2, "a healer cleric, a
sneaky rogue", Generate → open Adventure → wait for the job to finish → back to Party: nothing.

## Root cause / Fix
`PartyTab.tsx` keeps `mode` and `pregens` in component state (`useState`, line ~56–59), and
`HostPage.tsx` renders only the active tab (`{tab === "party" && <PartyTab …/>}`), so switching
tabs unmounts it and the in-flight `setPregens` lands on an unmounted component.
Fix (shipped): `HostPage.tsx` keeps `PartyTab` mounted (hidden when another tab is active), so
the pregens, sheet draft and form survive tab switches; `PartyTab` clears them when the campaign
changes.

## Notes
## TODOs
## Completed
- [x] 2026-10-20: Lift pregen results/drafts out of PartyTab (or keep tabs mounted)
- 2026-10-20: HostPage keeps PartyTab mounted (hidden) so pregens, the sheet draft and the form survive tab switches; PartyTab clears them when the campaign changes. Live check 2026-10-20 (no brain key, so a Build-one draft instead of pregens): the draft survived Party → Board → Party.
