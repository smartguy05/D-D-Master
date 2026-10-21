# Feature: Turn economy (movement, actions, bonus actions, reactions)
Status: done (vertical slice)
Docs: docs/gameplay/turn-economy.md, docs/reference/tool-catalog.md

## Overview
In combat the server enforces the SRD turn limits. A creature moves up to its Speed and has one
action and one bonus action on its turn, plus one reaction per round. A DM call past those limits
is refused with `{ error, refused: "turn_economy", budget }` and the DM reads it out. The DM can
pass `override: true` for real exceptions (Action Surge, Haste, a readied action). The host console
is never checked. The TV strip and the phone banner show what's left.

## Notes
- User decisions (2026-10-19):
  - Refuse, but let the DM override.
  - Enforce movement with Dash, action and bonus action, reactions, and acting only on your turn.
  - Infer spends from attack rolls and spells, plus an explicit `take_action` tool for the rest.
  - Show the budget on the TV and the phone, not the host.
- The code is in `engine/economy.ts`. `syncTurn` runs before and after every tool, and
  `economyGate` runs before the handler. A spend is committed only when the handler returned no
  `error`, so a cast with no free slot spends no action.
- The budget is keyed on entity + round, not on `turnIndex`. A lone combatant still resets each
  round, and `remove_monster` shifting `turnIndex` doesn't reset the budget mid-turn.
- What counts as an attack: `roll_dice` / `request_player_roll` with `target_id` and a d20 in the
  notation. Damage rolls with a `target_id` don't count. A `roll_dice` without `roller_id` belongs
  to the current creature.
- An override past a spent action starts a new Attack action (`attacksUsed = 1`), which is how
  Action Surge works.
- Monster Speed and Multiattack come from the SRD stat block (`multiattackCount` sums "one X attack
  and two Y attacks"). The hydra ("as many … as it has heads") and "uses Constrict" count as 1, so
  the DM overrides those.
- A physical-dice attack spends the action when `request_player_roll` is called, not when the roll
  is recorded. Asking again for the same attack is refused (use `override`).
- The session's `MAX_MOVES_PER_REPLY` is kept as a guard against runaway loops.
- The TV hides the budget on a hidden monster's turn so it doesn't give away the ambush.

## TODOs
- [ ] Difficult terrain cost (needs terrain cells on the map features)
- [ ] Prone: standing up costs half Speed; Exhaustion lowers Speed
- [ ] Fly/swim speeds for monsters
- [ ] Flurry of Blows / two bonus attacks without override
- [ ] Optional host Play-tab budget view with a reset button (not chosen for v1)
- [ ] Live voice play-test: "I run 60 feet and attack twice" with a level 1 fighter

## Completed
- 2026-10-21: Movement costs the squares of the route around walls/furniture (`planMove` in engine/movement.ts, shared with move_token); `ignore_terrain` counts the straight line (bugs/move-narrated-through-wall).
- 2026-10-20: Attack spells' own rolls after `cast_spell` are free (`turn.spellAttacks` + `spellAttackSpell`); targeted attack rolls default dc to AC; saves/checks with a target are not attacks.
- 2026-10-19: TurnBudget state, economy gate, take_action, override/action_type args, monster Speed
  and Multiattack parsing, persona bullet, TV and phone chips, tests
