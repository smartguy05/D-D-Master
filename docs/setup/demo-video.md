---
title: Product demo video (Remotion + live capture)
area: setup
topic: marketing
related_code:
  - marketing/demo-video/BRIEF.md
  - marketing/demo-video/src/**
  - marketing/demo-video/scripts/**
  - marketing/demo-video/capture/*.mjs
  - marketing/demo-video/capture/README.md
  - marketing/demo-video/audio/CREDITS.md
created: 2026-10-19
last_updated: 2026-10-19
last_audited: 2026-10-19
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-19: Initial version"
---

# Product demo video

`marketing/demo-video/` builds the ~30s "Hearthmaster" product demo: real footage captured from a
live campaign, composed and animated in Remotion, cut to a YouTube Audio Library track. It is
**not** part of the pnpm workspace: use `npm` inside it, never `pnpm`.

`BRIEF.md` is the source of truth: creative spec, shot list, and the file contract between the
three stages below.

## Layout

| Path | What |
|---|---|
| `BRIEF.md` | creative spec, shot ids, `shots.json` / `analysis.json` schemas |
| `capture/` | Playwright scripts that drive a live session and record shots ([README](../../marketing/demo-video/capture/README.md)) |
| `public/footage/<id>.mp4`, `shots.json` | captured clips (CFR 60fps) with highlight timestamps |
| `public/audio/track.mp3`, `analysis.json` | chosen track + beat grid (bpm, `windowStartSec`, `hitSec`) |
| `audio/CREDITS.md` | track credit and license notes |
| `src/` | Remotion project: `timing.ts`, `data.ts`, `Demo.tsx`, `scenes/`, `components/` |
| `scripts/make-sfx.sh`, `scripts/stills.mjs` | ffmpeg-synthesised SFX; per-bar stills + contact sheet |
| `out/` | renders (git-ignored) |

## Stages

1. **Capture.** Run a copy of the campaigns against an isolated server (PORT=8790, Vite on 5180) so
   the real saves and the dev servers are untouched. The text-mode DM (`POST /api/dm/text`, then
   `/api/dm/say {text, playerId}`) runs the session live; `/api/tools/:name` and the physical-roll
   endpoints force beats (e.g. a natural 20). Frames come from CDP screencast in headless Chrome on
   the hardware GPU and are mapped onto an exact 60fps grid. The text DM costs OpenAI calls.
2. **Music.** Chosen in YouTube Studio's Audio library, then analysed with librosa for bpm,
   downbeats and the loudest hit. The edit never time-stretches: the timeline is 15 bars at the
   track's own bpm (110.7 BPM gives 32.5s).
3. **Compose.** `src/timing.ts` turns bpm into `beat(n)` / `bar(n)` frames; every scene boundary is
   in `BEATS`, so a new track changes one number. `data.ts` loads both manifests in
   `calculateMetadata`; `<Shot>` starts each clip so a highlight (picked by regex from
   `SHOT_CONFIG` or a per-use `keyword`) lands on a chosen frame, and falls back to a still if the
   clip is missing.

## Commands (in `marketing/demo-video/`)

```bash
npm install
npm run preview          # Remotion studio
npm run stills           # out/contact-sheet.png, one frame per bar
node scripts/stills.mjs --frames=0,40,911   # specific frames
npm run render:draft     # out/draft.mp4, half-res
npm run render           # out/demo.mp4, 1080p60 H.264 CRF 18, AAC 320k
npm run render:vertical  # out/demo-vertical.mp4, 9:16
npm run typecheck
```

## Gotchas

- The live mic-level meter can't be shown in text mode; the voice beat uses typed speaker tags.
- Screencast only emits frames when the page changes, so static UIs (host, phone) report low
  source fps; that's expected, not choppiness.
- Never show "D&D" / "Dungeons & Dragons" in the video (WotC trademarks); "Compatible with 5e ·
  SRD 5.2" is fine.
- YouTube Audio Library terms clearly cover use on YouTube; check them before posting elsewhere.
