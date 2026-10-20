# Feature: Rules engine (slots, cast_spell, rests, level-up, death saves, concentration)
Status: done (vertical slice)
Docs: docs/gameplay/rules-engine.md, docs/reference/tool-catalog.md, docs/server/tools-engine.md

## Overview
TODO.md item 1, engine half (stream A2, 2026-10-18). Character rules state plus 8 DM tools
(`cast_spell`, `end_concentration`, `use_resource`, `short_rest`, `long_rest`, `level_up`,
`death_save`, `stabilize`). The engine applies the death-save and concentration rules on its own
inside `apply_damage`, `heal`, `add_condition`, `next_turn` and `record_physical_roll`. Data comes
from the SRD catalogs (stream A1, docs/server/rules-data.md).

## Notes
- Code is in `apps/server/src/engine/rules/` (derive, vitals, cast, rests, level, index). It is
  registered with small additive edits in `engine/tools.ts` (`...RULES_TOOLS`, `...RULES_HANDLERS`).
  `makeRoll` and the other roll helpers moved to `engine/rolls.ts`.
- Old saves: `hitDice.max === 0` means "not derived". `upgradeCharacters` runs in `loadCampaign`
  (and saves the result) and at the start of every `commit` (restored history, imports).
- `pendingRoll` has a single slot. Automatic requests never overwrite another prompt; instead the
  DM is told to call `record_physical_roll kind=…`. `request_player_roll` overwrites, with a
  `replaced` warning.
- Decisions:
  - cast_spell spends exactly the requested level (default: the spell's level) and never falls back
    to a higher slot; an error lists `free_slots`.
  - Rituals are free only with `as_ritual: true`.
  - Errors from cast_spell/level_up are returned as `{error}` objects (no throw), so no history
    entry is written.
  - Rests skip characters at 0 HP (SRD: you need at least 1 HP to rest).
  - Long Rest ends concentration (sleep = Unconscious) and clears temp HP.
  - Three death-save successes → Stable with the counts reset (SRD: "reset to zero when you …
    become Stable").
  - `heal` on a Dead PC is refused with a pointer to `revive {character_id, hp=1}` (review round 1;
    the earlier "heal revives" override was dropped). Revival spells in `cast_spell` only add a hint.
  - One slot per turn: warned, not refused (`Character.slotTurn`).
  - Casting time is enforced by the turn economy (`engine/economy.ts`, `spellCost`): action, bonus
    action (Misty Step) or reaction (Shield, allowed off-turn). See `features/turn-economy.md`.
  - Hand-added resources survive derive/level-up (= not in `ALL_CLASS_RESOURCE_NAMES`); a class
    change drops the old class's resources; host patch fields win over re-derived ones.
  - A host HP edit from ≤ 0 to > 0 wakes a downed PC (`regainedHp`) unless the patch sets
    conditions/deathSaves.
  - The concentration DC uses the whole damage, temp HP included. CON save proficiency comes from
    the sheet or the class's saving throws.
- `EngineOutcome.cast` (`SpellCast`) is the hook for stream F's spell animations. Nothing emits
  effects from it yet.

## TODOs
- [ ] Stream F: emit spell effects from `outcome.cast`.
- [ ] Arcane Recovery / Natural Recovery / Sorcerous Restoration as a tool (now `short_rest`
      `options` + manual edits).
- [ ] Stable creature regains 1 HP after 1d4 hours (DM uses `heal`).
- [ ] Monster spell slots and concentration (out of scope for this plan).
- [ ] Multiclassing (out of scope).

## Completed
- 2026-10-20: The TV's active party card (turn holder, else the talker) shows spell slots and class resources as pips (`tableRulesView`). A downed PC's turn passes on after their death save (bugs/turn-stuck-after-pc-death.md).
- 2026-10-20: One death save per combat turn (`deathSaves.lastRolled`); spell-linked conditions (`conditionMeta`, `rules/conditions.ts`); class saving throws filled when empty (`rules/saves.ts`); allies knocked out at 0 HP; `set_disposition`; `add_npc combatant`.
- 2026-10-18: Schema fields, derivation and old-save upgrade, all 8 tools, automatic death saves
  and concentration, party status and instructions, docs and tests.
- 2026-10-18: Review round 1 fixes: `revive` tool, first-turn death save in start_combat, level-up
  wakes a downed PC / refuses the dead, level-up features from the table row (ASI at every level),
  pending-roll fixes (second concentration save, stale saves cleared, kind=check applied as the
  pending save), one-slot-per-turn and Mystic Arcanum warnings, Exhaustion forms. Bugs:
  .memories/bugs/rules-review-*.md.
- 2026-10-18: Review round 2: ALL_CLASS_RESOURCE_NAMES, host HP edit wakes downed PCs, kind=check
  uses the pending DC, mutation tests for patched fields; remove_monster turnIndex fix.
- 2026-10-18: Stream D UI: phone/host/TV views for slots, hit dice, death-save pips,
  concentration, rest and level-up buttons (docs/web/player-view.md, host-ui.md, table-display.md).
