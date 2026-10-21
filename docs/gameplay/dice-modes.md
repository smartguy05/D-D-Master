---
title: Virtual vs physical dice
area: gameplay
topic: dice
related_code:
  - apps/server/src/engine/tools.ts
  - apps/web/src/table/TablePage.tsx
  - apps/web/src/host/PlayTab.tsx
  - apps/web/src/player/PlayerPage.tsx
created: 2026-09-24
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Audit: TablePage sound-unlock changes don't affect dice modes"
  - "2026-10-20: Party split: a physical roll pending in a parked scene waits until that scene is in focus"
  - "2026-10-20: Attacks: line of sight and cover raise the pending AC; cover shown in the breakdown"
  - "2026-10-20: Critical damage from the pads (pendingRoll.critical)"
  - "2026-10-20: Physical damage rolls (kind damage)"
  - "2026-10-20: Attack dc defaults to target AC; no double recording"
  - "2026-10-20: Attack dc defaults to target AC; no double recording"
  - "2026-10-19: Physical rolls can carry a natural 20/1 (DM arg or phone toggle)"
  - "2026-09-24: Initial version"
  - "2026-09-24: Phone rolls and physical number pad"
  - "2026-10-18: Physical death and concentration saves (pendingRoll.kind)"
  - "2026-10-18: Physical attack rolls keep target_id/attack_name and animate on record"
---

# Virtual vs physical dice

Each character has a **dice mode** (set in the form or editor): 💻 `virtual` or 🎲 `physical`.
The DM's own rolls (monsters, secret checks) are always virtual 3D dice.

| | Virtual | Physical |
|---|---|---|
| DM asks for a check | `request_player_roll` rolls immediately; 3D dice fly on the TV | `request_player_roll` sets `pendingRoll`; the TV shows "🎲 Lyra, roll 1d20+2 for Perception!" |
| Result | Returned to the DM right away with success or fail against the DC | The player says the total out loud; the DM calls `record_physical_roll` (with `natural: 20` or `1` when the player says so). Or the player enters it on the phone pad (⭐ Natural 20 / 💀 Natural 1 toggles for d20 rolls), or the host types it in on the Play tab |
| On the TV | Dice animation, then a toast | Toast marked "physical dice" |

- **Phones** ([player view](../web/player-view.md)): virtual-dice players can roll any skill, save,
  attack or notation from their phone. The TV animates the roll and the DM gets a note. For
  physical-dice players, a pending roll shows a number pad on their own phone, and only that player
  can answer it. Players can switch their own dice mode there.
- **Death and concentration saves** (automatic, see [rules engine](rules-engine.md)): virtual
  players roll them at once with 3D dice. Physical players get a pending roll of `kind`
  `death_save` (the bare d20, 1–20) or `concentration` (total vs the DC), answered the same way.
  There is only one pending roll: an automatic save never replaces someone else's prompt; the DM is
  told to record it later with `record_physical_roll kind=…`.
- **Attack animations**: an attack roll with `target_id` animates on the TV (swing, arrow or spell
  orb, then hit/miss/crit). Virtual: at once. Physical: the target and `attack_name` are kept on
  `pendingRoll` and the animation plays when `record_physical_roll` records the total (outcome
  against the `dc`, which defaults to the target's AC; a spoken natural 20/1 is passed as
  `natural`). With both tokens on the board, an attack with no line of sight is refused, and
  half / three-quarters cover raises the AC by 2 / 5: `pendingRoll.dc` stores the raised AC and
  `pendingRoll.cover` the cover, which the recorded roll, the log line and the TV toast show
  ("vs AC 15 (half cover +2)"). A total the phone or host already recorded is not recorded twice when the DM
  repeats it within 15 s (`already_recorded`).
- **Damage** (physical players roll their own): after a hit the DM calls `request_player_roll`
  with `kind: "damage"` and `target_id`. Virtual dice roll it at once. Physical dice set
  `pendingRoll` kind `damage`; the TV shows "💥 Lyra, roll 1d8+3 damage!" and the total from the
  phone pad, host pad or `record_physical_roll` is applied to the target (no `apply_damage`). A
  damage roll spends no action. The DM's own and monster damage stays virtual. After a critical
  hit (`critical: true` on the request, or inferred when the player's last roll was an attack roll
  at the same target (`RollResult.attack`/`targetId`) within 2 minutes showing a natural 20; a
  natural 20 check or save doesn't count; with several attacks rolled before their damage the DM
  passes `critical`) `pendingRoll.critical` is set: the TV says "roll twice", and the
  phone pad and host pad have a 💥 Critical toggle preset from it; the recorded damage is applied
  as critical (2 death-save failures on a downed PC). Virtual dice roll a critical damage request
  with the dice doubled (`doubleDice`: 1d8+3 → 2d8+3) and the hint says `apply_damage … critical: true`. A virtual player's roll never clears another player's pending prompt.
- **Advantage and disadvantage** use `2d20kh1` / `2d20kl1`. The dropped die is shown grey.
- **Secret rolls** (`secret: true`) are logged but show no dice or total on the TV; the DM still
  gets the number.
- **Initiative** is rolled automatically for everyone when combat starts, so the order appears at
  once. Physical-dice players who want to roll their own can ask the DM to adjust.
- **Party split**: a physical roll asked for in a group's scene is parked with that scene when the DM
  cuts away. The phone shows "waits for the DM" instead of the pad, and the total can be entered once
  that scene is back in focus ([party split](party-split.md)).
