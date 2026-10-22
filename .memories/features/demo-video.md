# Feature: Product demo video
Status: in-progress
Docs: docs/setup/demo-video.md

## Overview
Two cuts: `Tour`, the ~2 min narrated feature tour (main video since 2026-10-21), and `Demo`, the
~32s music-only teaser.
~30s "Hearthmaster" product demo in `marketing/demo-video/` (Remotion, own npm project). Footage
captured live from campaign `cmp_cbe6567b3b` (smuggler's cove) on an isolated server; music
"Claim of Thrones" by RKVC (YouTube Audio Library, no attribution needed).

## Notes
- Product name "Hearthmaster" (chosen 2026-10-19, used everywhere since 2026-10-22; see general/decisions.md). Keep "D&D" out of all marketing.
- Built by three parallel agents (music, capture, animation) against `BRIEF.md`; that contract is
  what lets any one part be redone alone.
- Track is 110.7 BPM, so the video is 15 bars = 32.5s; we chose not to stretch to 120.
- In-person framing: no human figures yet; room shots are swappable scene components so filmed
  table footage can replace them later.
- `combat-turn` footage has a forced 4 damage after a kobold miss (11 vs AC 16); the edit cuts
  around it. Retake if that segment is ever used longer.
- Live capture cost < $2 of OpenAI for ~25 DM turns + 3 NPC TTS clips.

- Tour (2026-10-21): the user asked for the new features, the sprites and narration, and picked
  "narrator + DM voice" and "~2 min". It is the whole track (55 bars). The narrator is TTS `onyx`.
  DM lines are the live text DM's real replies, voiced in `cedar`. NPC/AI lines are the server's
  own clips. The player's door line is TTS `coral` (a dramatization of a typed line).
- v2 capture used the scratch copy at the session's scratchpad (`cap-data`); the server's state
  there changed (Pip joined, harbormaster added, walls on the lighthouse). The real campaigns were
  never touched.
- Lighthouse walls/doors in the footage are hand-drawn with `edit_walls` (map predates detection).

## TODOs
- [ ] User watches/listens to `out/tour.mp4` and approves narration voice, mix and pacing
- [ ] Optional: retake `party-split` with a closer camera on Quill at the lighthouse (reads small)
- [ ] User listens to the track excerpt (37.1s–69.7s) and approves the draft
- [ ] Final 1080p60 render + optional 9:16 cut
- [ ] Optional: replace room mockups with filmed table footage
- [ ] Release date + real CTA URL on the end card when known

## Completed
- 2026-10-19: Brief, music pick + beat analysis, live capture of all 8 shots, Remotion project,
  half-res draft with music
- 2026-10-21: Tour composition: 12 new v2 takes, narration + DM voice (`npm run voice`), 1080p60 render
- 2026-10-21: Footage and audio (~50MB) are committed under `marketing/demo-video` (found settled at the memory audit)
