---
title: Rules search and SRD monsters
area: server
topic: rules
related_code:
  - apps/server/src/rules/**
  - data/srd/**
  - rules/custom/**
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-20: Template defaults (speed 30, attacksPerAction 1, combatant, neutral, conditionMeta and the other Monster fields); find order; test list"
  - "2026-10-19: Monster speed and Multiattack count (multiattackCount) for the turn economy"
  - "2026-09-24: Initial version (SRD 5.2.1 markdown, MiniSearch)"
  - "2026-10-18: Pointer to the structured spell/class catalogs (docs/server/rules-data.md)"
  - "2026-10-18: Monster attacks keep \"Melee/Ranged Attack Roll\" in description (board animations)"
---

# Rules search and SRD monsters

## Source data

`data/srd/*.md` holds the **D&D System Reference Document 5.2.1** (CC-BY-4.0) in Markdown, taken
from `github.com/downfallx/dnd-5e-srd-markdown` at commit `1b4b99d`. `data/srd/LICENSE.md` carries
the required attribution. Do not add non-SRD Wizards of the Coast content to the repo.

House rules and homebrew go in `rules/custom/` as `.md`, `.txt` or `.pdf`. They are loaded at
server start, and PDF text is extracted with `pdf-parse`.

## Index (`rules/srd.ts`)

- `chunkMarkdown` splits at h1–h4 headings and keeps a breadcrumb (`file > h2 > h3`). Stat-block
  subsections (`Actions`, `Traits`, `Bonus Actions`, `Reactions`, `Legendary Actions`) stay inside
  their monster's chunk. Chunks are capped at 4000 characters.
- `cleanMarkdown` collapses the SRD's HTML ability tables into
  `STR 8 (−1, save −1); DEX 15 …` and strips the other tags.
- `RulesIndex` uses MiniSearch (BM25 with prefix and fuzzy 0.15 matching). The title has boost 4 and
  the breadcrumb 1.5. **Custom rules get a 1.5× boost**, so a house rule wins over the SRD.
- `lookup(q)` returns the top 3 chunks, trimmed to about 2500 characters, as model-facing text.
  House rules are labelled `HOUSE RULE`.

## Monster catalog (`rules/monsters.ts`)

- It parses stat blocks from `monsters-A-Z.md` (names are `###` headings) and `animals.md`
  (names are `##` headings). That gives about 330 monsters.
- Fields extracted: AC, HP, initiative bonus, CR, walking Speed (`**Speed** 25 ft.` → `speed`), the
  Multiattack count (`multiattackCount`: "two Rend attacks" = 2, "one Bite attack and one Claw
  attack" = 2 → `attacksPerAction`, for the [turn economy](../gameplay/turn-economy.md)), the six ability scores (from the HTML table), and
  attacks (`_Melee/Ranged Attack Roll:_ +4 … _Hit:_ 5 (1d6 + 2) Slashing` → `{ toHit: 4, damage: "1d6+2 slashing", description: "Melee Attack Roll" }`; the description is the
  attack kind, used by `attackStyle` to pick a swing or an arrow on the TV).
- Each entry is a `MonsterTemplate` (a `Monster` without `id` and `hp`). Fields the stat block
  doesn't give get the schema defaults, so spawned monsters are ordinary foes: `speed` 30 and
  `attacksPerAction` 1 when missing, `combatant: true` (rolls initiative), `neutral: false`,
  `ally`/`follows`/`npc`/`hidden` false, and empty `conditions`, `conditionMeta` and `appearance`.
  Disposition changes later go through `set_disposition` (see the
  [tool catalog](../reference/tool-catalog.md)).
- `find(name)` tries an exact match, then the singular form (wolves → wolf, harpies → harpy), then a
  prefix of the singular, then contains.

## Spells and classes

Structured spell and class data (`rules/spells.ts`, `rules/classes.ts`) is documented in
`docs/server/rules-data.md`.

## Tests

`apps/server/src/rules/rules.test.ts` runs against the real SRD data: chunking, a Fireball lookup,
the Grappled condition, the Goblin Warrior's parsed stats, plural matching, walking Speed and the
Multiattack count (Aboleth, Chimera, `multiattackCount` phrasings), and the Melee/Ranged kind in
attack descriptions.
