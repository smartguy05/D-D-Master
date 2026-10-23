# Bug: Party tab squeezed into a 360px column on the right
Status: fixed (2026-10-22)
Area: web

## Overview
During the Party tab redesign, the whole tab rendered as a narrow absolutely-positioned panel on
the right edge of /host, with horizontal scroll.

## Repro
Wrap the Party tab in `<div className="party">` and open /host → Party.

## Root cause / Fix
`app.css` already has `.party` for the TV's party sidebar (`position: absolute; right: 0; width:
360px`). The class name is global, so the host wrapper picked it up. Renamed the wrapper to
`.party-tab`. Caught by the first screenshot, never shipped.

## Notes
The stylesheet is one global file with short class names (`.party`, `.play`, `.log`). Grep
`styles/app.css` for a class before adding a new one.

## TODOs

## Completed
- 2026-10-22: renamed to `.party-tab`.
