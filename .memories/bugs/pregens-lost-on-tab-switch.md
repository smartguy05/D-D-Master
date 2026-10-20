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
Fix idea: keep the pregen results (and drafts) above the tab switch (HostPage state or a small
store), or keep tabs mounted and hide them with CSS.

## Notes
## TODOs
- [ ] Live check: pregen results survive a tab switch (no unit test: React component)
## Completed
- [x] 2026-10-20: Lift pregen results/drafts out of PartyTab (or keep tabs mounted)
- 2026-10-20: HostPage keeps PartyTab mounted (hidden) so pregens, the sheet draft and the form survive tab switches; PartyTab clears them when the campaign changes. (Live check in the final browser pass.)
