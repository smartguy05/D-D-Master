# Feature: Product demo video
Status: in-progress
Docs: docs/setup/demo-video.md

## Overview
~30s "Hearthmaster" product demo in `marketing/demo-video/` (Remotion, own npm project). Footage
captured live from campaign `cmp_cbe6567b3b` (smuggler's cove) on an isolated server; music
"Claim of Thrones" by RKVC (YouTube Audio Library, no attribution needed).

## Notes
- Working name "Hearthmaster" (chosen 2026-10-19). Keep "D&D" out of all marketing.
- Built by three parallel agents (music, capture, animation) against `BRIEF.md`; that contract is
  what lets any one part be redone alone.
- Track is 110.7 BPM, so the video is 15 bars = 32.5s; we chose not to stretch to 120.
- In-person framing: no human figures yet; room shots are swappable scene components so filmed
  table footage can replace them later.
- `combat-turn` footage has a forced 4 damage after a kobold miss (11 vs AC 16); the edit cuts
  around it. Retake if that segment is ever used longer.
- Live capture cost < $2 of OpenAI for ~25 DM turns + 3 NPC TTS clips.

## TODOs
- [ ] User listens to the track excerpt (37.1s–69.7s) and approves the draft
- [ ] Final 1080p60 render + optional 9:16 cut
- [ ] Optional: replace room mockups with filmed table footage
- [ ] Release date + real CTA URL on the end card when known

## Completed
- 2026-10-19: Brief, music pick + beat analysis, live capture of all 8 shots, Remotion project,
  half-res draft with music
- 2026-10-21: Footage and audio (~50MB) are committed under `marketing/demo-video` (found settled at the memory audit)
