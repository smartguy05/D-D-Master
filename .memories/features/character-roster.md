# Feature: Global character roster
Status: done (vertical slice)
Docs: docs/gameplay/character-roster.md, docs/server/http-api.md, docs/server/persistence.md, docs/reference/game-state.md, docs/reference/tool-catalog.md (end_campaign), docs/server/history-and-bundles.md, docs/web/host-ui.md

## Overview
Heroes outlive a campaign. A global roster (SQLite `roster_characters` + `roster_voiceprints`,
portraits in `<dataDir>/roster/assets`) keeps a fresh snapshot of a character (level, abilities,
features, spells, items, gold, subclass, portrait) and the player's voiceprint. A campaign
character links to it with `Character.rosterId`. Heroes join a later campaign as a new character
with their voice already known.

## Notes
- Pure helpers: `apps/server/src/game/roster.ts` (`snapshotForRoster` on top of `freshCharacter`
  from reset.ts, `rosterEntryFrom`, portrait copy helpers taking `dataDir`).
- Service: `listRoster`, `saveToRoster`, `saveAllToRoster`, `joinFromRoster`, `deleteRoster`;
  `endCampaign` calls `saveLinkedToRoster` (each save in its own try/catch).
- Linking `rosterId` is `mutate` without a label: not an undo entry. Undoing to a snapshot older
  than the link drops `rosterId`; a re-save then creates a second roster entry (accepted).
- Join: new `pc_…` id, full HP, item ids regenerated only where they collide, player resolved
  before any state change (explicit id > same-name free player > new player; same-name player who
  already plays someone -> error asking for an explicit player). Undoable.
- Portrait URLs: `/media/roster/<rosterId>.png` through the existing `/media/:campaignId/:file`
  route. Item `iconUrl`s are cleared in the snapshot (campaign media).
- Routes: `apps/server/src/routes/roster.ts` (registered by `registerApi`). Tests build Fastify
  with index.ts's error handler and use `app.inject`.
- Web: `apps/web/src/host/roster.ts` (`rosterLabel`, `unlinkedCharacters`, `rosterPrompt`,
  `joinBlocked`, `updatedAgo`), `RosterPanel.tsx` (Party tab "Bring an existing hero"), Save/Update
  roster buttons and "linked" badge in PartyTab, end-of-campaign banner in HostPage. HostPage holds
  a roster version counter bumped after each save/join/delete so the panel refetches.
- Spec test fix (part 1): the "Twin" item-id uniqueness test got its own playerName, because
  copying Mara's player "Sam" (who already plays Mara) must throw per the join rules.

## TODOs
- [ ] Live check: save a PC, end the campaign, join it into a new campaign; confirm voice ID
      recognises the player without re-recording. (see general/live-test-checklist.md)
- [ ] `RosterEntry.campaignsPlayed` is in the schema but nothing counts it yet.
- [ ] Optional: show roster heroes on the TV campaign-complete screen ("saved to the roster").

## Completed
- 2026-10-21: [x] Guard `<dataDir>/roster` against a campaign id `roster`
  (bugs/roster-media-dir-collision.md): GameService load/delete, Store get/delete, route 400; tests
  show the roster portraits survive.
- 2026-10-20: Shared `Character.rosterId` and `RosterEntry`; Store roster tables and methods;
  `game/roster.ts` snapshot/entry/portrait helpers; GameService save/save-all/join/delete/list;
  end_campaign auto-save with `roster: {saved, unlinked}`; roster routes; bundles/reset keep
  `rosterId`; tests for every layer.
- 2026-10-20: Host web: Roster panel, Save/Update roster buttons, Save all, end-of-campaign prompt;
  docs/gameplay/character-roster.md and doc updates.
- 2026-10-20: Review fixes: undo/rewind of a join drops the copied voiceprint and orphan rows
  (`.memories/bugs/roster-join-undo-orphan-voiceprint.md`); portrait URL carries `?v=<hash>`
  (`roster-portrait-stale-cache.md`); Roster panel refetches when the campaign ends
  (`roster-panel-stale-after-end-campaign.md`).
