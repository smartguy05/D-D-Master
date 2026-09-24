---
title: DM tool catalog
area: reference
topic: tools
related_code:
  - packages/shared/src/tools.ts
  - apps/server/src/engine/tools.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version (22 tools)"
  - "2026-09-24: reveal_area, set_fog, play_effect; automatic effects and fog reveal"
---

# DM tool catalog

The Realtime DM calls these tools, and the host can call them through `POST /api/tools/:name`.
The schemas are in `packages/shared/src/tools.ts`. Ids can be replaced by names, which are resolved
by exact match, then player name, then prefix.

| Tool | Args | Effect / returns |
|---|---|---|
| `get_party_status` | — | Location, grid, characters (HP, AC, conditions, dice mode, gold, items, pos), monsters (HP, AC, attacks, pos), combat order |
| `roll_dice` | `notation, label, roller_id?, secret?, dc?` | Rolls; the TV animates it. Returns total, dice (dropped in parentheses), modifier, natural 20 or 1, success |
| `request_player_roll` | `character_id, notation, label, dc?` | Virtual: rolls now. Physical: sets `pendingRoll` and returns an instruction |
| `record_physical_roll` | `character_id, notation, label, total, dc?` | Records a spoken physical result and clears `pendingRoll` |
| `apply_damage` | `target_id, amount, damage_type?` | Temp HP first, clamped at 0, then Unconscious (PC) or Dead (monster) |
| `heal` | `target_id, amount` | Clamped at max HP; clears Unconscious or Dead |
| `set_temp_hp` | `target_id, amount` | Keeps the higher of the old and new values (5e rule) |
| `add_condition` / `remove_condition` | `target_id, condition` | Title-cased, no duplicates |
| `give_item` | `character_id, name, qty=1, description?` | Stacks by case-insensitive name |
| `remove_item` | `character_id, name, qty=1` | Exact or partial name; removes the entry at 0 |
| `adjust_gold` | `character_id, amount` | Negative spends; errors if it can't be afforded |
| `move_token` | `entity_id, x, y` | Clamped to the grid; nudged to the nearest free cell if occupied |
| `spawn_monster` | `name, count=1, x?, y?, hp?, ac?` | SRD stats when the name matches; numbered names; tokens placed; sprites generated |
| `remove_monster` | `monster_id` | Removes the monster, its token and its initiative entry |
| `start_combat` | — | Rolls initiative for everyone standing; returns the order |
| `next_turn` | — | Next living combatant; round increments on wrap |
| `end_combat` | — | Clears combat |
| `change_scene` | `location_id` (id or name) | New map, monsters cleared, party placed, instructions refreshed |
| `lookup_rule` | `query` | Top SRD and house-rule passages (about 2500 characters) |
| `consult_brain` | `question` | Planner guidance (up to 120 words) from the outline, recaps and recent play |
| `confirm_speaker` | `player_name` (player or character) | Sets the active speaker and teaches that player's voiceprint the last uncertain sample |
| `reveal_area` | `x, y, radius=3` or `x, y, w, h` | Adds a circle (dx²+dy² ≤ r²+r) or a rectangle (top-left x, y) to the current location's revealed cells, clipped to the grid. Works even while fog is off (pre-reveal). Returns new and total revealed cells |
| `set_fog` | `mode: enable \| disable \| reset` | Fog of war for the current location. `reset` forgets explored cells; the party's light is re-revealed immediately |
| `play_effect` | `kind, target_id?, source_id?, x?, y?, radius?` | A visual on the table only (no state change). `kind`: hit, crit, miss, heal, slash, fireball, lightning, frost, poison, radiant, necrotic, thunder, arcane. Needs `target_id` or `x, y` |

**Automatic effects** (no tool call needed): `apply_damage` with amount > 0 emits a `hit` (tinted by
`damage_type`), `heal` emits `heal`, and a visible `roll_dice`/`request_player_roll` with a natural
20 or 1 emits `crit` or `miss` on the roller. **Automatic reveal**: after every engine tool, when
fog is on, each character reveals a circle of its `lightRadius` (default 6) around its token.

Adding a tool:
1. Add its schema and description in `ToolArgs` and `TOOL_DESCRIPTIONS`.
2. Add a handler in `engine/tools.ts` (list it in `ENGINE_TOOLS`), or a case in `GameService.runTool`.
3. Add a test and update this table.
4. If the DM should use it proactively, mention it in the persona in `realtime/instructions.ts`.
