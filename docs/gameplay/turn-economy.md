---
title: Turn economy (movement, actions, reactions)
area: gameplay
topic: combat
related_code:
  - apps/server/src/engine/movement.ts
  - apps/server/src/engine/economy.ts
  - apps/server/src/engine/economy.test.ts
  - packages/shared/src/turn.ts
  - packages/shared/src/turn.test.ts
  - apps/web/src/lib/TurnBudgetChips.tsx
created: 2026-10-19
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Movement costs the routed squares (planMove/findPath), ignore_terrain counts the straight line"
  - "2026-10-20: Spell attack rolls after cast_spell are part of its action (spellAttacks)"
  - "2026-10-19: Initial version: turn budget, refusals, override, take_action, TV/phone chips"
---

# Turn economy

In combat the server enforces the SRD 5.2 turn limits ("Your Turn", Playing the Game). On its turn
a creature moves up to its Speed, takes **one action** and maybe **one bonus action**. It also has
**one reaction**, which comes back at the start of its own turn. The voice DM used to let players
move any distance and attack any number of times. Now the tools refuse, and the DM tells the
player what they have left.

## State

These fields are in `packages/shared/src/schemas.ts`. All of them have defaults, so old saves
still load.

| Field | Meaning |
|---|---|
| `combat.turn` (`TurnBudget` or null) | Budget for the creature whose turn it is: `entityId`, `round`, `speed`, `movementUsed`, `extraMovement` (Dash), `action`, `bonusAction`, `attacksUsed`, `attacksPerAction`, `disengaged`, `dodging` |
| `combat.reactionsUsed` | Ids of creatures that used their reaction since the start of their last turn |
| `Monster.speed` | Walking Speed in feet. Parsed from the SRD stat block (`**Speed** 25 ft.`), default 30 |
| `Monster.attacksPerAction` | Multiattack count. Parsed from the first sentence of the Multiattack ("two Rend attacks" = 2, "one Bite attack and one Claw attack" = 2) |
| `Character.speed` | Already existed (default 30) |

`syncTurn` (`engine/economy.ts`) runs before and after every engine tool in `executeEngineTool`:

- **A new creature or a new round** gets a fresh budget and its reaction back. The budget is keyed
  on entity + round, so a lone combatant still resets, and `remove_monster` shifting `turnIndex`
  does not.
- **`speed`** is refreshed on every call: 0 while the creature is Grappled, Paralyzed, Petrified,
  Restrained, Unconscious or Dead.
- **Out of combat** the budget is `null` and `reactionsUsed` is empty.

`attacksPerAction` for characters comes from `features`: Extra Attack = 2, Two Extra Attacks = 3,
Three Extra Attacks = 4.

## What spends what

| Tool | Spends |
|---|---|
| `move_token` | Feet walked: the squares of the route `planMove` walks around walls, doors and furniture × 5, diagonals 5 ft too (SRD "Entering a Square"); with `ignore_terrain` the straight Chebyshev squares. The refusal says when the cost is a route around the walls. Counted to the cell the token actually lands on, nothing when it didn't move. A token's first placement is free |
| `roll_dice` / `request_player_roll` with `target_id` and a d20 | The action (first attack). Later attacks fit in the same action up to `attacksPerAction`. `action_type: "bonus_action"` uses the bonus action (off-hand, Flurry), `"reaction"` the reaction (opportunity attack, allowed off-turn). Damage rolls (no d20) cost nothing. A `roll_dice` without `roller_id` belongs to the creature whose turn it is. `cast_spell` of an attack spell on the caster's turn sets `turn.spellAttacks` to its attack count (projectiles, else 1: Guiding Bolt 1, Scorching Ray 3+, Spiritual Weapon 1); that many following attack rolls whose `attack_name`/label name the spell (a word of it, "Ray 2") or say "spell" are part of the cast and cost nothing more (`turn.spellAttackSpell`); a weapon attack spends normally (a cantrip doesn't make later weapon attacks free). The same spell cast again adds its rays. Targeted rolls labelled "save", "check" or "contest" aren't attacks |
| `cast_spell` | The spell's casting time: `reaction` spells (Shield) use the reaction (allowed off-turn), `bonusAction` spells (Misty Step) the bonus action, everything else the action. The one-slot-per-turn warning is separate (rules engine) |
| `take_action` | `cost` (default `action`) for Dash, Dodge, Disengage, Help, Hide, Ready, Search, Study, Influence, Magic, Utilize, other. Dash adds the creature's Speed to `extraMovement`. Disengage and Dodge set their flags |

A spend is recorded only after the tool succeeded. A `cast_spell` with no free slot spends no
action.

## Refusals

DM calls (`ctx.source` `"dm"`) are checked in `economyGate`, before the handler runs. A refused
call returns this, and the state is unchanged:

```json
{ "error": "Thorin has 10 ft of movement left this turn; that move is 25 ft (5 squares). ...",
  "refused": "turn_economy",
  "budget": { "creature": "Thorin", "movement_left_ft": 10, "action": "available", "bonus_action": "available", "reaction": "available" },
  "retry": "If a feature really allows it, call again with override: true." }
```

A call is refused when:
- The creature acts or moves when it isn't its turn, unless it's a reaction.
- A move is longer than the movement left.
- The action is spent (all its attacks made), or the bonus action or reaction is spent.
- The creature is Incapacitated (or Stunned, Paralyzed...).

**`override: true`** on `move_token`, `roll_dice`, `request_player_roll`, `cast_spell` or
`take_action` skips the check, and the spend is still recorded. An override attack after the
action is spent starts a new Attack action (`attacksUsed` = 1), which is how Action Surge works.

**Not checked:** the host console (`source: "host"`, e.g. dragging tokens on the Board tab),
creatures that aren't in the initiative order, and anything out of combat.

The session's per-reply move cap (`MAX_MOVES_PER_REPLY` in `realtime/session.ts`) is still in place
as a guard against runaway loops.

## Voice DM

- **Persona.** `realtime/instructions.ts` has one MECHANICS bullet: limits are enforced, use
  `take_action` for non-attack actions, `action_type` for bonus and opportunity attacks, and on a
  refusal tell the player what's left. Use `override` only for a real feature.
- **Monster turns.** `dmTurnInstruction` (`engine/turns.ts`) tells the DM the monster's movement in
  feet and its Multiattack count.
- **Party status.** `get_party_status` → `combat.turn` (the budget view) and `reactions_used`.

## Display

`turnBudgetParts(combat)` (`packages/shared/src/turn.ts`) turns the budget into chips: `20/30 ft`,
`Action` or `Action (1/2 attacks)`, `Bonus`, `Reaction`. Used chips are dimmed.
`TurnBudgetChips` (`apps/web/src/lib/TurnBudgetChips.tsx`) renders them in two places:

- **TV.** Under the initiative strip (`.turn-budget`). Hidden for a hidden monster's turn, which
  would give the ambush away.
- **Phone.** Inside the "Your turn!" banner. Off-turn, the phone shows "Reaction ready" or
  "Reaction used this round".

## Not in v1

- Difficult terrain cost, fly and swim speeds, Prone stand-up cost, and Exhaustion speed loss.
- Free object interactions.
- Haste and Action Surge as tracked resources (use `override`).
- Flurry of Blows' second bonus attack (use `override`).
- Reactions triggered automatically.
