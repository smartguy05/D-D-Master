---
title: Moments (victory, death, revival, turn banner, battle intro, attitude, campaign end)
area: gameplay
topic: moments
related_code:
  - apps/server/src/engine/moments.ts
  - apps/web/src/table/momentPlan.ts
  - apps/web/src/table/MomentOverlay.tsx
  - apps/web/src/table/boardHold.ts
created: 2026-10-21
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Initial version: kinds, where each is emitted, the TV pipeline and the rules for adding one"
---

# Moments

Moments are the big beats shown on the TV: a victory banner, a death, a PC back on their feet, a
turn banner, a battle intro, an NPC changing sides, and the campaign-complete screen. They are
**transient**. The server sends `{type:"moment", moment}` and never stores moments in `GameState`,
the event log or the hub snapshot, so a reload shows the state, not the moment.

`Moment` (`packages/shared/src/schemas.ts`) is `{id, kind, targetId?, outcome?, text?, ts}`. `text`
carries the `end_campaign` epilogue.

## Kinds

`MomentKind`: `victory`, `defeat`, `fled`, `death`, `revived`, `campaign_end`, `turn_start`,
`attitude`, `combat_start`.

| Kind | Emitted by | `outcome` |
|---|---|---|
| `combat_start` | `start_combat`, before the first `turn_start` | — |
| `turn_start` | `start_combat` (first creature) and `beginTurn` (`next_turn`, or a turn passed by `leaveInitiativeAndBegin` from `remove_monster` / `set_disposition`) | — |
| `death` | PC: inside `die()` (`engine/rules/vitals.ts`), so every path gives exactly one. Monster: `applyDamage` on a non-ally going from >0 to 0 HP | `monster` for a monster |
| `revived` | `afterHealing` when HP was ≤0, a natural 20 death save; `revive` | `rallied` (back up from 0 HP, not Dead); none for a true `revive` |
| `victory` / `defeat` / `fled` | `announceCombatResult` after every engine tool except start/end_combat, once per combat (`Combat.announced`); `end_combat {outcome?}` | — |
| `attitude` | `adjust_attitude` crossing a threshold ([NPC attitude](npc-attitude.md)) | `hostile` / `indifferent` / `friendly` |
| `campaign_end` | `end_campaign` (service tool), or the death rule ending the campaign | `success` / `failure` |

Notes:
- `rallied` is an outcome, not a kind.
- `regainedHp` emits nothing, so host HP patches and level-up stay silent.
- Moments are built only through `moment()` in `engine/moments.ts` and collected on
  `EngineOutcome.moments`.
- Victory counts only this combat's foes (`combatFoes`), so old corpses don't count
  (bugs/false-victory-from-corpses). A DM `end_combat` victory is refused while a foe is still
  standing (bugs/victory-with-foe-standing). `victory_hint` waits while any PC is dying.
- Death rule (`Campaign.deathRule`): after every engine tool `runTool` checks
  `deathRuleEnds(rule, before, after)` and, if the rule is met, auto-ends the campaign in failure.
  The `death` moment broadcasts first, then `campaign_end`. Before the rule is met (`deathRuleMet`),
  the DM is not allowed to end the campaign in failure.

## TV pipeline (`apps/web/src/table/`)

1. **`useServer(..., onMoment)`** receives the event.
2. **`momentForTable`** (`visibility.ts`) drops `death`, `revived`, `turn_start` and `attitude`
   moments whose target the TV can't see (hidden or fogged).
3. **The moment is held behind the dice.** `momentPlan.releaseHeldMoments` waits for the dice tray
   and for held board effects, with `HOLD_CAP_MS` as the cap. HP changes and removed creatures wait
   too (`boardHold.ts`). The turn marker uses `shownTurn`. A dying token stays standing while its
   death moment is held (`heldStanding` / `tokenFallen`).
4. **Overlay queue.** `enqueueMoment` / `nextOverlay` / `dismiss` play moments first in, first out.
   If several turn banners are waiting, only the newest unshown one plays. `holdsDice` keeps the dice
   waiting while the intro and turn banners play.
5. **Presentation** (`momentPlan.ts`, pure and tested):
   - `momentVariant` picks the presentation.
   - `MOMENT_MS` sets each moment's duration.
   - `soundForMoment` picks the sound. The recipes are in `dice/sound.ts`. A full-screen overlay
     plays its sound when it becomes current, so a queued banner is not heard early. Other
     variants play their sound on release.
   - `tokenMomentPose` poses the token while the moment plays. Afterwards the token eases to the
     pose the state implies.
   - `introTiming` / `initiativeForTable` deal the initiative order in the battle intro.
   - `MomentOverlay.tsx` draws it.

## Adding a moment kind

1. Add the kind to `MomentKind`, and its outcome if it needs one, in `schemas.ts`. Moments are not
   persisted, so the change is save-safe.
2. Emit it via `moment()` from the engine, or from a service method for state outside `GameState`
   (like `end_campaign`).
3. If it has a target, filter it in `momentForTable` and add a test.
4. Add its variant, duration and sound in `momentPlan.ts`, its drawing in `MomentOverlay.tsx` /
   `MapBoard.tsx`, and tests in `momentPlan.test.ts`.
5. Update this doc, [table display](../web/table-display.md) and the
   [tool catalog](../reference/tool-catalog.md) if a tool output changed.

See also [design rules](../architecture/design-rules.md) §1 and §7.

## Known limits

- Not checked live yet: whether the DM speaks the announce line before a monster's first attack,
  and the banner timings, sound levels and tip-over look on the real TV.
- "Desaturate" is a grey tint on the standee material, not a real desaturation shader.
