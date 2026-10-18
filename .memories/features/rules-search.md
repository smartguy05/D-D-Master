# Feature: Rules search (SRD 5.2.1 + house rules)
Status: done (vertical slice)
Docs: docs/server/rules-search.md, docs/server/rules-data.md

## Overview
SRD 5.2.1 Markdown (CC-BY-4.0) in data/srd, chunked by heading and indexed with MiniSearch.
Custom rules (md/txt/pdf) in rules/custom are boosted 1.5×. Monster stat blocks are parsed into a
catalog (about 330) that spawn_monster uses.

## Notes
- Source: github.com/downfallx/dnd-5e-srd-markdown @ 1b4b99d. dndbeyond.com (the official PDF) was
  blocked from the build sandbox.
- animals.md uses `##` for names, while monsters-A-Z uses `###` (see bugs/srd-animals-heading-level.md).

- Structured data (2026-10-18): `rules/spells.ts` SpellCatalog (339 spells) and `rules/classes.ts`
  ClassCatalog (12 classes × 20 levels, slots, Pact Magic, resources, feature text). Types and pure
  helpers (`spellEffectAt`, `resourcesFor`, `hitDieFor`, `proficiencyBonusFor`) are in
  `packages/shared/src/rules-data.ts`. Exposed to the engine as `ctx.spell(name)` / `ctx.classData(name)`.
- spells.md has non-spell `####` headings (rules sub-sections, summoned stat-block `#### Actions`)
  and `## <Creature>` stat blocks inside spells; a block is a spell only with the `_Level N School (…)_`
  / `_School Cantrip (…)_` line, and splitting at h1–h4 keeps stat blocks out of spell text.
- classes.md tables: two-row thead with `colspan` for slot columns; some rows have a trailing empty
  `<td>`; `—` = 0/none. Resource reset rules are hand-curated from the feature text (RESOURCE_RULES).

- Review round 1 (2026-10-18): damage entries carry `role` base|or|later (heuristic: "or" between
  entries in one sentence; timing cues → later; Prismatic Spray/Wall and Arcane Hand are listed
  "mode" spells); `primaryDamage()` = what to roll on a hit. Upcast `damageIncrements` are filtered
  by type/role or applied by index. `find` is strict (exact key → unique prefix → unique
  edit-distance ≤2 for 5+ chars); `candidates()` / `ctx.spellCandidates` for "did you mean".
  Spell bodies are parsed line by line (SRD glues paragraphs to the Duration line and upcast lines
  to the previous paragraph). Resources gained `note` and subclass rules.

## TODOs
- [ ] Spell damage written without dice ("damage equal to twice the feet moved") and damage inside
      summoned stat blocks are not captured; callers fall back to `summary` / `upcast.text`
- [ ] Damage roles/increments are heuristics; extend tests if a spell shows up wrong in play
- [ ] Only the one SRD subclass per class exists; non-SRD subclasses would need house-rule data
- [ ] Optional embedding search for fuzzy natural-language questions
- [ ] Hot-reload rules/custom without a restart

## Completed
- 2026-09-24: Index, lookup tool, host search UI, monster catalog, tests.
- 2026-10-18: Parse spells into structured data (level, save, damage, area, upcast, cantrip scaling)
  and class tables (slots, pact magic, resources, features) — stream A1 rules-data.
- 2026-10-18: Review round 1 fixes (damage roles, multi-damage upcast, strict find, parse accuracy,
  extra class/subclass resources, level clamp, feature-name normalisation).
