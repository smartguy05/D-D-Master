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

## TODOs
- [ ] Live-test outline quality with each provider and tune the prompt
- [ ] Edit the outline in the UI (rename/add locations, tweak map prompts)
- [ ] Generate NPC portraits
- [ ] Scene art (painterly establishing shots) in addition to battle maps
- [ ] Anthropic structured outputs (`output_config.format`) instead of prompt-JSON

## Completed
- 2026-09-24: Outline, maps, character + monster sprites, consult, session recap.
