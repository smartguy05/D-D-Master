# Bug: NPC close-up swaps the portrait for a letter plate on a partial-name clip
Status: fixed (2026-10-21)
Area: web

## Overview
With "Captain Mara Venn" in focus, a `speak_as_npc` clip named "Venn" replaced her portrait in the
TV close-up with a plain "V" letter plate (and the name plate read "Venn") for as long as the line
was up.

## Repro
1. `npc_focus` on "Captain Mara Venn" (an NPC with a portrait).
2. The DM calls `speak_as_npc` with `npc: "Venn"` (no portrait on the clip, not an AI player).
3. The close-up shows "V" instead of the portrait until the line fades.

## Root cause / Fix
`NpcCloseup.tsx` attached `{name, portraitUrl, pc}` as the line's speaker for every clip, and
`caption.ts closeupSubject` shows the speaker whenever its name differs from the focus name. The
AI-player close-up (2026-10-21) introduced that swap. Fix: `clipSpeaker(c)` in `caption.ts` only
returns a speaker when the clip brings its own face (`pc` or a `portraitUrl`); NpcCloseup uses it.

## Notes
Name matching (fuzzy "Venn" ~ "Captain Mara Venn") was not used: a clip without a face never has
a reason to replace the focused portrait.

## TODOs

## Completed
- 2026-10-21: `clipSpeaker` + caption.test.ts cases (bare-name clip keeps the focus; AI player and
  portrait clips still take over).
