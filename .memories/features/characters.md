# Feature: Characters (create / import / pregens)
Status: done (vertical slice)
Docs: docs/gameplay/characters.md

## Overview
Three paths (all were requested): a manual form, pasted-sheet import (brain parse), and AI pregens.
Every character gets a color and an AI sprite from its `appearance`. The host override editor fixes
anything.

## TODOs
- [ ] Guided creation by *talking* to the DM (voice character builder)
- [ ] PDF upload for sheet import (currently paste text)
- [ ] Spell slots, hit dice, death saves, level-up
- [ ] Validate against SRD class/species rules

## Completed
- 2026-09-24: Form, import, pregens, editor, sprite redraw.
