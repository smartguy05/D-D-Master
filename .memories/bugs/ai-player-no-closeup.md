# Bug: an AI player's line has no TV close-up (avatar + subtitles)
Status: fixed (2026-10-21)
Area: server (realtime/npc-queue.ts, players/ai-player.ts, game/service.ts), web (table/NpcCloseup.tsx, table/caption.ts)

## Overview
When an AI player talked, the TV played the audio but showed no portrait or text. NPC lines get
a close-up with portrait, name plate and paced subtitles. If an NPC was in focus, the AI player's
words showed up as subtitles under the **NPC's** portrait.

## Repro
Seat an AI player, let it speak (Nudge). With no NPC focus nothing shows on /table. With
`npc_focus` set, the line appears under the NPC's name.

## Root cause / Fix
- AI lines reuse the NPC clip queue (`speakAiLine` → `playOnSlot` → `npc_speech`), but
  `NpcCloseup` only rendered `npc_focus` and attached any caption to whoever had focus.
- Fix: `npc_speech` carries an optional `portraitUrl` (the character's `spriteUrl`) and `pc: true`
  (`NpcClip`, `playOnSlot`'s `speaker` argument). On the web, `clipLine(line, speaker)` stores the
  clip's speaker, and `closeupSubject(focus, line, now)` shows that speaker while its line is visible
  and differs from the focus. After the linger, the focus comes back (or nothing). The `.pc` class
  uses the accent colour.

## Notes
- The DM's own captions (`caption` events) have no speaker, so they still attach to the focus.

## TODOs
- [ ] Live-test with a real AI seat on the TV

## Completed
- 2026-10-21: Fix + tests (npc-queue.test.ts, ai-player.test.ts playOnSlot, caption.test.ts closeupSubject).
