# Bug: small host layout issues (Board toolbar, feature labels, Reset panel)
Status: open
Area: web (host)

## Overview
- Board tab: the toolbar row reflows when the Undo label changes length, so the mode buttons jump.
- Board tab: map-feature labels near the right edge are clipped ("Open crate on the broken dec…").
- Adventure tab: the Reset panel renders beside the campaign row and squeezes it; host-ui.md says it
  opens under the row.

## Repro
Test run 2026-10-19, The Smuggler's Cove board; Reset on the imported copy.

## TODOs
- [ ] Fixed-width/ellipsis Undo label; clamp label x inside the board; Reset panel full width below row
## Completed
