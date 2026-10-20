# Bug: the TV DM orb says "Listening" while the table mic is muted
Status: fixed (2026-10-20)
Area: web (table display)

## Overview
With the hard mute on, the TV shows the red "The DM isn't listening" banner while the DM orb in the
bottom-left still reads "Listening" (cyan). The two contradict each other.

## Repro
Test run 2026-10-19: text DM running, host *🔇 Mute table mic* → TV.

## Root cause / Fix
The orb only follows `dm.status`. Fix: show "Muted" (grey/red) on the orb while `view.micMuted`.

## TODOs
## Completed
- [x] 2026-10-20: Orb muted state
- 2026-10-20: table/orb.ts orbLabel/orbClass: a listening DM shows 'Muted' (dim red) while the table mic is muted; thinking/speaking/offline unchanged. Tests: orb.test.ts.
