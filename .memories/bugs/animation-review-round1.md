# Bug: attack/spell animation review round 1 (wf/animations)
Status: fixed (2026-10-18)

## Overview
Adversarial review of stream F found eight issues in the first cut of the automatic animations.

## Repro
Tests in `packages/shared/src/effects.test.ts`, `apps/server/src/engine/effects.test.ts` and
`apps/web/src/table/effectPlan.test.ts` (blocks marked "review round 1").

## Root cause / Fix
1. A PC's "Fire Bolt" under `attacks` matched as a weapon → melee swing. Fix: an entry without SRD
   Melee/Ranged text named exactly like an SRD spell is that spell.
2. `apply_damage` with a source but no resolvable attack defaulted to a melee swing (Fireball
   follow-ups swung a sword). Fix: `resolveAttack` returns undefined; damage uses the source's only
   attack, else a plain hit with no travel.
3. `cast_spell` spell-attack orbs exploded in the element even when the roll then missed, and the
   roll's outcome could land before the orb. Fix: those orbs are travel-only (neutral spark); a
   suppressed repeat waits for the earlier landing (`travelSuppressed` returns the earlier effect).
4. An unknown `target_id` dropped the roller's nat-20/1 flash. Fix: fall back whenever no attack effect.
5. `projectileSplit` gave 0-dart targets (schema count min 1). Fix: only as many targets as darts.
6. Magical ranged monster attacks (Necrotic Ray) flew a wooden arrow. Fix: ranged + non-physical
   damage type → spell.
7. "Elbow" matched the bow keyword. Fix: whole-word (short|long|cross)bow(s); "Melee or Ranged"
   now uses token distance (within 1 cell = melee).
8. TablePage kept only the last 16 effects, cutting animations off in busy moments. Fix: prune by
   age only, cap 60.

## Notes
Extra mutation tests added: emanation always on the caster, no travel at distance ≤ 0.5, the kept
die decides the natural with advantage.

## TODOs
- [ ] Fireball follow-up damage from a caster whose only attack is a cantrip flies that cantrip's orb (no attack_name given); acceptable for now.

## Completed
- 2026-10-18: all eight fixed with tests.
