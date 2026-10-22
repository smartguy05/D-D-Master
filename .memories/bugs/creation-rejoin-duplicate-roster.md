# Bug: undoing a phone join and joining again made a second roster entry
Status: fixed (2026-10-22)
Area: server (game/creation/flow.ts)

## Overview
A phone join saves the hero to the roster. Undoing the join removes the character (and its
`rosterId`). Joining again created a new character without a link, so `saveToRoster` added a second
"Mara" to the roster.

## Repro
`service.creation.test.ts` › "undoing the join makes it a draft again…": join, undo, join → the roster has 1 entry.

## Root cause / Fix
- Undo restores GameState only (design-rules §6), and the roster link lived only on the character.
- Fix: `CreationDraft.rosterId` stores what `saveToRoster` returned. `join` passes it to
  `addCharacter`, so the new character is linked and the save updates the same row.

## TODOs
## Completed
- 2026-10-22: Fixed with a test.
