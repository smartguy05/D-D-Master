# Bug: /play call tiles spread out and stacked on phones (`.play` class collision)
Status: fixed (2026-10-22)
Area: web

## Overview
The first version of `call/VideoStrip.tsx` named its modifiers after the page (`call-strip play`,
`call-strip table`). `.play` already exists in `styles/app.css`: the host's Play tab is a 3-column
grid that becomes 1 column under 820 px. On `/play` the tiles were spread across the map row, and at
phone width they stacked vertically.

## Repro
Headless Chromium e2e (two `/play` + `/table`, phase 5): the `/play` screenshot showed three tiles
at x≈12, 305 and 648; at 390 px wide they stacked.

## Root cause / Fix
A global class name was reused. The modifiers are now `call-side` (TV) and `call-row` (`/play`), and
everything in `call/call.css` is scoped under `.call-strip` / `.call-tile` / `.call-*`.

## Notes
- Before adding a short class like `.play`, `.table` or `.row`, grep `apps/web/src/**/*.css`: app.css
  has many global ones.

## TODOs

## Completed
- 2026-10-22: Found in the phase 5 e2e screenshots; renamed and re-checked.
