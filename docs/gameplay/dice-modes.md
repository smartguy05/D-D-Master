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
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version"
  - "2026-09-24: Phone rolls and physical number pad"
---

# Virtual vs physical dice

Each character has a **dice mode** (set in the form or editor): 💻 `virtual` or 🎲 `physical`.
The DM's own rolls (monsters, secret checks) are always virtual 3D dice.

| | Virtual | Physical |
|---|---|---|
| DM asks for a check | `request_player_roll` rolls immediately; 3D dice fly on the TV | `request_player_roll` sets `pendingRoll`; the TV shows "🎲 Lyra, roll 1d20+2 for Perception!" |
| Result | Returned to the DM right away with success or fail against the DC | The player says the total out loud; the DM calls `record_physical_roll`. Or the host types it in on the Play tab |
| On the TV | Dice animation, then a toast | Toast marked "physical dice" |

- **Phones** ([player view](../web/player-view.md)): virtual-dice players can roll any skill, save,
  attack or notation from their phone. The TV animates the roll and the DM gets a note. For
  physical-dice players, a pending roll shows a number pad on their own phone, and only that player
  can answer it. Players can switch their own dice mode there.
- **Advantage and disadvantage** use `2d20kh1` / `2d20kl1`. The dropped die is shown grey.
- **Secret rolls** (`secret: true`) are logged but show no dice or total on the TV; the DM still
  gets the number.
- **Initiative** is rolled automatically for everyone when combat starts, so the order appears at
  once. Physical-dice players who want to roll their own can ask the DM to adjust.
