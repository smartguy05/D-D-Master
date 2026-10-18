# Bug: SRD spell text glued to stat lines / upcast lines dropped
Status: fixed (2026-10-18)
Area: server (rules/spells.ts)

## Overview
Found in adversarial review round 1 of stream A1. The spell parser split spell bodies on blank lines:
- It dropped any paragraph that began with `**Duration:**`, and in the SRD markdown the first
  description paragraph sometimes follows the Duration line with no blank line. As a result Heat
  Metal had no damage, Moonbeam had no area and Charm Monster had no save or summary.
- An `_Using a Higher-Level Spell Slot._` line with no blank line before it was merged into the
  previous paragraph, so Ice Storm, Wall of Ice and Giant Insect lost their upcast rule.

## Repro
`new SpellCatalog().load("data/srd")`. Then `get("Heat Metal").damage` was `[]`, and
`get("Ice Storm").upcast` was undefined.

## Root cause / Fix
The parser assumed paragraphs are separated by blank lines. The fix parses line by line: drop each
`**X:**` stat line, and start a new section at each upgrade marker.

The same review also found these problems in the same parser:
- `find` picked an arbitrary spell for an ambiguous query ("Fire").
- multiple damage types were treated as additive (Spirit Guardians).
- per-level dice went onto the first damage entry only.
- an "Advantage on … saving throws" clause was taken as the spell's save.
- size limits ("no larger than a 5-foot Cube") were taken as areas.

All of these are fixed.

Round 2 (2026-10-18) found more in the same parser:
- dedupe on equal dice+type dropped real repeat hits (Searing Smite, Wall of Fire);
- "A or B damage" type lists were missed (Forbiddance, Glyph of Warding);
- some cylinder and line phrasings were missed;
- edit distance 2 on 5-letter queries matched unrelated spells ("links" → Blink).
All fixed with tests.

## Notes
The tests are in `apps/server/src/rules/spells.test.ts`, in the "review round 1" describe blocks.

## TODOs
## Completed
- 2026-10-18: Fixed with tests.
