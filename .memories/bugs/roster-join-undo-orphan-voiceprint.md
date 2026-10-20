# Bug: undoing joinFromRoster left the copied voiceprint behind
Status: fixed (2026-10-20)
Area: server (roster, speaker ID, history)

## Overview
`GameService.joinFromRoster` copies the roster voiceprint into the campaign's `voiceprints` table
outside `mutate()`. Undo/rewind (`restoreEntry`) only rolls back GameState, so the row stayed: an
orphan for a newly created player, or a voiceprint the reused player never had. A second join then
wrote the same embedding for a new player id; `matchSpeaker` saw two identical prints (margin 0 <
minMargin), so the match was never confident and could point at a player no longer in state.

## Repro
Mara in the roster with a voiceprint, campaign B loaded. Join (creates plr_1, row (B, plr_1)),
Undo, Join again (plr_2, row (B, plr_2) with the same embedding). `getVoiceprints(B)` returns two
rows; identify() is never confident.

## Root cause / Fix
Voiceprint rows are side state that undo ignored. Fix in `apps/server/src/game/service.ts`:
- `restoreEntry` calls `dropVoiceprintsUndoneBy(campaignId, current, snapshot)` before rebuilding
  voiceSamples: for each roster-linked character the restore removes, if its player had
  `voiceSamples === 0` in the snapshot and its row equals the roster embedding, the row is deleted;
  then every row whose player is not in the restored state is deleted (`pruneVoiceprints`).
- `joinFromRoster` also prunes orphan rows before copying, so older orphans cannot duplicate it.
Tests: `service.roster.test.ts` "joinFromRoster voiceprint" (undo, rewind, reused player with and
without an earlier voiceprint, orphan pruning on join).

## Notes
A player's own enrollment made after the join and before an undo of the join is also dropped when
it equals the roster embedding only; a different embedding is kept.

## TODOs

## Completed
- [x] 2026-10-20: regression tests + undo/join voiceprint cleanup.
