---
title: NPC attitude and Influence
area: gameplay
topic: npc-attitude
related_code:
  - packages/shared/src/attitude.ts
  - apps/web/src/lib/tokenColor.ts
  - apps/web/src/lib/attitudeBadge.ts
created: 2026-10-21
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Initial version, gathered from tool-catalog, host-ui, table-display and .memories/features/npc-attitude.md"
---

# NPC attitude and Influence

Every monster and NPC (a `Monster`, with `npc: true` for story NPCs) has a 2024 SRD attitude:
Hostile, Indifferent or Friendly. The attitude sits on a gradual score from -5 to +5. The DM moves
the score after meaningful interactions. Crossing a threshold changes which side the creature is on
and whether it is in initiative.

## Scale (`packages/shared/src/attitude.ts`)

| Score | Attitude | Disposition (side) |
|---|---|---|
| ≤ -3 | Hostile | foe |
| -2 … +2 | Indifferent | neutral |
| ≥ +3 | Friendly | ally |

- `attitudeForScore`, `dispositionForAttitude`, `attitudeForDisposition`, `clampAttitudeScore`
  (rounded, limited to -5..+5) and `formatAttitude` ("Friendly (+3)") are pure helpers shared with
  the web.
- `attitudeOf(m)` returns the stored `attitude` / `attitudeScore` when they are set. Otherwise it
  derives them from the old flags: neutral gives Indifferent 0, ally gives Friendly +3, anything else
  gives Hostile -3. Neutral wins over ally.
- Schema: `Monster.attitude?`, `attitudeScore?` and `voice?` are optional and have **no default**, so
  older saves still load and keep deriving the attitude from their flags.

## Tools

- `adjust_attitude {npc_id, delta, reason}` moves the score.
  - Within a band, only the score changes, plus a log line.
  - Across a threshold, it logs `<Name> is now Friendly (+3): <reason>`, applies the new
    disposition and emits a transient `attitude` [moment](moments.md). The moment's outcome is the
    new attitude, and the TV flashes the token ring.
  - It never kills a downed NPC (`killDowned` is false; bugs/attitude-drift-kills-downed-npc).
- `set_disposition foe|ally|neutral` is the hard override. It shares `applyDisposition`
  (`engine/tools.ts`) with `adjust_attitude`: it sets the flags and has the creature join or leave
  initiative. `syncAttitude` keeps the score consistent:
  - foe sets the score to `min(score, -3)`;
  - neutral clamps the stored score to -2..2 (0 if the score was derived);
  - ally sets the score to `max(score, 3)`.
- `add_npc` gives new NPCs Friendly +3 (`ally`) or Hostile -3 (`ally: false`), plus a voice
  direction (`defaultNpcVoice(name)`, the same fallback that `speak_as_npc` uses). Calling it again
  with `ally` re-syncs the attitude.
- `get_party_status` reports each creature's attitude fields.

Full arguments are in the [tool catalog](../reference/tool-catalog.md).

## The DM's side

- The instructions include an **NPCs here** block: every creature with a token, with its attitude.
  It is refreshed after any tool in `CREATURE_LIST_TOOLS` (`game/service.ts`): `adjust_attitude`,
  `set_disposition`, `add_npc`, `spawn_monster`, `remove_monster` and others
  (bugs/npcs-here-list-stale).
- The persona gives suggested deltas: +1 for a kind word, +2 for real help or a fitting gift, -1 for
  rudeness, -2 for an insult or a threat, and ±1 after an Influence check.
- **Influence** follows the SRD 5.2 rules as written.
  - The creature is Willing (no check), Unwilling (no check, it refuses) or Hesitant.
  - A Hesitant creature calls for Persuasion, Deception, Intimidation or Performance (Animal
    Handling for a Beast or Monstrosity). The DC is 15 or the creature's Intelligence score,
    whichever is higher.
  - Friendly gives Advantage and Hostile gives Disadvantage.
  - After a failure, the same urging can't be tried again for 24 hours.

## Screens

- **Host Board → Monsters panel**: an attitude badge (`lib/attitudeBadge.ts`, e.g. "🙂 Friendly +3")
  with −/＋ buttons that call `adjust_attitude ±1` with a host reason. See [host UI](../web/host-ui.md).
- **TV**: the token ring colour comes from `attitudeColor` / `monsterColor` (`lib/tokenColor.ts`).
  The ally and foe lists show badges. Indifferent creatures are on neither list, so for them only the
  ring colour shows the attitude. `momentPlan.ringFlash` pulses the ring on an `attitude` moment.
  `momentForTable` drops the moments of hidden monsters, because the chime would give an ambusher
  away (bugs/attitude-moment-leaks-hidden-monster). See [table display](../web/table-display.md).

## Known limits

- Not live-tested yet: whether the DM calls `adjust_attitude` on its own with sensible deltas, and
  whether it uses Influence checks with the right DC.
