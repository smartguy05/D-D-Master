# Bug: a spell attack roll after cast_spell is refused (action spent twice)
Status: fixed (2026-10-20)
Area: server (turn economy)

## Overview
`cast_spell` spends the caster's action. The spell's attack roll (`request_player_roll` with
`target_id`) then also tries to spend the action and is refused by the turn economy. The slot is
gone, the spell never resolves, and the DM told the player "you already used your action earlier".

## Repro
Test run 2026-10-19: Morra casts Guiding Bolt at the Ogre (events 530–532). Turn state after:
`action: true, attacksUsed: 1`. Only a host whisper ("retry with override: true") recovered it.
Affects every attack-roll spell cast through `cast_spell` (Guiding Bolt, Inflict Wounds, Scorching
Ray, Chromatic Orb…). Cantrips the DM rolls without `cast_spell` (Fire Bolt) are fine.

## Root cause / Fix
`docs/gameplay/turn-economy.md` "What spends what": both `cast_spell` and a targeted d20 roll spend
"the action". Fix (shipped): `cast_spell` of an attack spell sets `TurnBudget.spellAttacks` to the projectile
count (else 1) in `engine/economy.ts`; that many targeted attack rolls are then free in the same
action (bonus-action spells too), after which normal spending applies. Tests: `economy.test.ts`,
`attack-rules.test.ts`.

## TODOs
## Completed
- [x] 2026-10-20: Engine fix + test (cast_spell then request_player_roll with target_id succeeds)
- 2026-10-20: cast_spell of an attack spell sets TurnBudget.spellAttacks = projectiles (else 1); that many attack rolls are free (bonus-action spells too), then normal spending. Tests: economy.test.ts, attack-rules.test.ts.
