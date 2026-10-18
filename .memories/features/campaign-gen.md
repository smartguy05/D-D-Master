# Feature: Campaign generation, maps and sprites
Status: done (vertical slice)
Docs: docs/server/brain-providers.md, docs/server/images.md

## Overview
From a premise, the brain writes an Outline (acts, locations with top-down map prompts and grid
sizes, NPCs, encounters using SRD monster names). Maps come from the OpenAI Images API
(1536×1024), and sprites use a transparent 1024×1024 image. Both are cached by prompt hash and
served under /media.

## Notes
- The brain is configurable: OpenAI (Responses API, default gpt-5) or Anthropic (Messages API
  streaming, default claude-opus-5). JSON output is prompt + zod validation + one repair retry, so
  it's provider-agnostic.
- consult_brain gives mid-session story guidance. The DM is told to say something in character
  while it waits.
- Outline edits: `mapUrl` is server-owned; the client can't set it. Removing a location in the UI
  removes its encounters (the server rejects encounters pointing at unknown locations).
- Map orientation contract: party enters LEFT edge, far end/focal feature RIGHT edge. Matches
  engine placement (`placeCharacters` x=1, `spawn_monster` default gridW-3). Enforced in the
  image prompt (`MAP_LAYOUT` in images/index.ts), the outline prompt and the DM's location line.
  Image models default to focal-point-top / entrance-bottom without it.
- Map features: the image model only partly obeys layout (2026-10-18 nave repaint: door moved left,
  altar stayed top-centre), so the painted map is the source of truth. After each paint the brain
  reads the PNG (`readMapFeatures`, vision) into `location.features` (entrance/exit/focal/feature,
  lit) in grid cells; the engine places the party at the entrance, spawns at focal, lit features
  glow through fog, and a repaint of the current scene restages it (`restageForMap`, not in combat).
  Reading takes ~23 s with gpt-5 and varies run to run (pews sometimes listed, sometimes not).
- Repaint with an unchanged prompt returns the cached PNG (hash of model|size|prompt) but still
  re-reads features, so it is a free way to restage.

## TODOs
- [ ] Live-test outline quality with each provider and tune the prompt
- [ ] Generate NPC portraits
- [ ] Scene art (painterly establishing shots) in addition to battle maps
- [ ] Anthropic structured outputs (`output_config.format`) instead of prompt-JSON
- [ ] Show map features on /host (and let the host drag/fix them)
- [ ] Use non-entrance features as blocking terrain / cover for movement and light
- [ ] Per-location entrance side (if a map needs e.g. a bottom entrance), driving both the prompt
  and party placement

## Completed
- 2026-10-18: Map features read from painted maps drive party entry, spawns, fog glow and DM context.
- 2026-10-18: Map prompts pin the left-to-right layout so painted maps match token placement.
- 2026-09-24: Outline editor on the Adventure tab (acts, locations, NPCs, encounters with SRD
  autocomplete) + PUT /api/campaign/outline (zod-validated; keeps mapUrl unless mapPrompt changed;
  refreshes the DM). Logic in apps/server/src/game/outline.ts.
- 2026-09-24: Outline, maps, character + monster sprites, consult, session recap.
