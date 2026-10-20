# Bug: the host Board tab draws every monster red
Status: fixed (2026-10-20)
Area: web (host Board tab)

## Overview
`BoardTab.tsx` colours a token `ch?.color ?? "#e0463c"`, so allies (`ally: true`) and neutral
creatures (`neutral: true`, set_disposition) look like foes on /host, while the TV (`MapBoard.tsx`)
shows them green and amber.

## Repro
Live check 2026-10-20: add_npc Pell (ally) + set_disposition neutral on a goblin → /host Board:
all monster tokens red; TV: Pell green, the goblin amber.

## Root cause / Fix
The colour rule lives inline in MapBoard only. Fix: a shared `monsterColor` helper
(`apps/web/src/lib/tokenColor.ts`) used by both screens.

## TODOs
## Completed
- [x] 2026-10-20: Shared helper + test; BoardTab and MapBoard use it
- 2026-10-20: lib/tokenColor.ts monsterColor (via dispositionOf) shared by MapBoard and BoardTab; tooltips say ally/neutral. Test: tokenColor.test.ts. Live check 2026-10-20: neutral amber, ally green, foes red on /host.
