# Bug: Roster cards misaligned, player select overflows the card
Status: fixed (2026-10-23)
Area: web

## Overview
On the host Party tab, picking a seat with no character and opening **Bring an existing hero** showed
roster cards of uneven layout, and the "Player: match “…” or add" select stuck out past the card's
right edge.

## Repro
/host → Party → select a seat with "no character yet" → *Bring an existing hero* at a ~1300px pane.

## Root cause / Fix
- The roster reused `.pregens` (`minmax(220px, 1fr)`), so six narrow cards fit per row. A `<select>`
  sizes to its longest option and, as a flex item with `min-width: auto`, wouldn't shrink, so it
  overflowed. The header `.row` wrapped, so the voice pill landed under the name in some cards and
  beside it in others; the "Already in this campaign" note pushed the actions down unevenly.
- `styles/app.css`: `.pregens.roster` uses `minmax(280px, 1fr)`; `.roster-entry` is a flex column;
  `.roster-head` doesn't wrap (text `min-width: 0`, pill `flex: none`); `.roster-actions` has
  `margin-top: auto` and its select is full-width with `min-width: 0`. `RosterPanel.tsx` moves the
  blocked note into the name block so the action rows align.
- Verified in Chrome against the dev server (no unit test: pure CSS/layout).

## Notes
A `<select>` in a flex row needs `min-width: 0` (or a set width) or long option text overflows.

## TODOs
## Completed
- 2026-10-23: Fixed as above.
