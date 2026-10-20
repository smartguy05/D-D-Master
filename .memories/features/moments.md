# Feature: Moments (victory, death, revival, campaign end, turn indicator)
Status: done (vertical slice)
Docs: docs/reference/tool-catalog.md, docs/server/tools-engine.md, docs/reference/game-state.md,
docs/architecture/data-flow.md, docs/gameplay/rules-engine.md, docs/web/table-display.md,
docs/web/host-ui.md, docs/web/dice-3d.md

## Overview
Big table moments for the TV: a victory/defeat/fled banner, a death, a PC back up ("rallied") or
truly revived, a turn banner, and a campaign-complete screen. The server sends them as transient
`{type:"moment", moment}` events; the web overlay queues them behind the dice.

## Notes
- `Moment` (shared schemas.ts): `{id, kind, targetId?, outcome?, text?, ts}`. `text` carries the
  `end_campaign` epilogue. Never stored in GameState, the event log or the hub snapshot.
- Engine: `EngineOutcome.moments`, built only through `engine/moments.ts` `moment()`.
  - `turn_start`: `start_combat` (first creature) and `beginTurn` (next_turn, and a turn passed by
    `leaveInitiativeAndBegin` from remove_monster / set_disposition).
  - Monster `death` (outcome `monster`): `applyDamage` on a non-ally from >0 to 0 HP.
  - PC `death`: inside `die()` in vitals.ts, so every path (massive damage, damage at 0 HP, a third
    failed save virtual or recorded) gives exactly one.
  - `revived` + `rallied`: `afterHealing(state, c, before, sink)` when `before <= 0`, and a natural 20
    in `applyDeathSave`. `revive` pushes `revived` with no outcome. `regainedHp` itself pushes
    nothing, so host character HP patches (service.ts) and level-up stay silent (decision).
  - Victory/defeat: `announceCombatResult` after every engine tool except start/end_combat, once
    per combat via the persisted `Combat.announced` (default []). Victory adds `victory_hint` to an
    object output. `end_combat {outcome?}` auto-detects and skips a kind already announced.
  - `foesOf(state)` in turns.ts (`!ally && !neutral`) is shared by `stalledTurn` and victory.
  - `combat.announced ??= []` in `announceCombatResult` tolerates hand-built states (old tests).
- `end_campaign {outcome, epilogue?}` is a service tool (Campaign is not in GameState): sets
  `Campaign.status` completed/failed + `completedAt`, `saveCampaign` (broadcast), a system log line,
  and a `campaign_end` moment. `{error}` when not active. `resetCampaign` reopens it. Bundles keep it.

- Web (`apps/web/src/table/`): `useServer(..., onMoment)` → `momentForTable` (drops hidden
  monsters' death/revived/turn_start) → held behind dice and held board effects
  (`momentPlan.releaseHeldMoments`, HOLD_CAP_MS cap) → overlay queue (`enqueueMoment`/`nextOverlay`/
  `dismiss`, FIFO, newest unshown turn banner wins), rallied toast, token animation.
  `momentPlan.ts` is pure and tested: `momentVariant`, `MOMENT_MS`, `soundForMoment`,
  `tokenMomentPose`. Sounds: victory/death/revive/campaign recipes in `dice/sound.ts`.
- Token pose while a moment plays comes from `tokenMomentPose`; afterwards the token eases to the
  pose the state implies (`TokenView.fallen`: Dead PC or foe at 0 HP), so a reload looks right.
  Tilt rotates a group inside the drei Billboard around the standee's foot (rotation.z), so it falls
  sideways in screen space whatever the camera angle. "Desaturate" is a tint toward grey on the
  standee material colour (no shader patch).
- The overlay's sound plays when it becomes current, not when it is released, so a queued banner is
  not heard early. Non-full-screen variants sound on release.
- Now panel (`nowPanel.ts`): PC exact HP, monster HP band (`hpBand`, also used by the foes list),
  hidden monster → `{name:"Unknown foe", hidden:true}` and no budget chips.
- Host Play tab: end_combat outcome picker (auto/Victory/Fled/Defeat) and End campaign (outcome,
  optional epilogue, confirm); disabled with the status once the campaign is not active.

## TODOs
- [ ] Live check on the real TV: banner timings, sound levels, tip-over look from the steep camera.
- [ ] Optional true desaturation (shader) instead of the grey tint, if the tint reads poorly.

## Completed
- 2026-10-20: Roster auto-save hooks into `end_campaign`: every linked PC is saved back to the
  global roster; the result carries `roster: {saved, unlinked}` (see features/character-roster.md).
- 2026-10-20: Shared schemas (Moment, MomentKind, Campaign.status/completedAt, Combat.announced),
  `moment` ServerEvent, end_combat outcome, end_campaign tool; engine moments, auto victory/defeat,
  service broadcast and end_campaign; persona lines; docs.
- 2026-10-20: Web: useServer onMoment, `momentForTable`, `momentPlan.ts`, `nowPanel.ts`,
  `MomentOverlay.tsx` (+ `mo-*` keyframes), MapBoard token death/revive poses, mist and golden
  column, turn spotlight (pulsing ring + beam + light), Now panel, moment sounds, host End-combat
  outcome and End campaign buttons; docs table-display, host-ui, dice-3d, data-flow.
- 2026-10-20: Review fixes: victory counts only this combat's foes (`combatFoes`, no old corpses)
  and `end_combat` is a no-op out of combat (bugs/false-victory-from-corpses); `victory_hint` waits
  for dying PCs (bugs/victory-hint-while-dying); host `end_campaign` notes the live DM and the
  instructions state a finished campaign (bugs/host-end-campaign-dm-unaware); a dead token stays up
  while its death moment is held (bugs/token-falls-before-death-moment).
