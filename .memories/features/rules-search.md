# Feature: Rules search (SRD 5.2.1 + house rules)
Status: done (vertical slice)
Docs: docs/server/rules-search.md

## Overview
SRD 5.2.1 Markdown (CC-BY-4.0) in data/srd, chunked by heading and indexed with MiniSearch.
Custom rules (md/txt/pdf) in rules/custom are boosted 1.5×. Monster stat blocks are parsed into a
catalog (about 330) that spawn_monster uses.

## Notes
- Source: github.com/downfallx/dnd-5e-srd-markdown @ 1b4b99d. dndbeyond.com (the official PDF) was
  blocked from the build sandbox.
- animals.md uses `##` for names, while monsters-A-Z uses `###` (see bugs/srd-animals-heading-level.md).

## TODOs
- [ ] Optional embedding search for fuzzy natural-language questions
- [ ] Parse spells into structured data (level, save, damage) for auto-resolution
- [ ] Hot-reload rules/custom without a restart

## Completed
- 2026-09-24: Index, lookup tool, host search UI, monster catalog, tests.
