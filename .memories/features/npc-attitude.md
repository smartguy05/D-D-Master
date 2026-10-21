# Feature: NPC attitude scale
Status: done (vertical slice)
Docs: docs/web/host-ui.md, docs/web/table-display.md, docs/reference/tool-catalog.md (adjust_attitude, set_disposition, add_npc), docs/gameplay/running-a-session.md, docs/server/realtime-sideband.md, docs/reference/game-state.md

## Overview
Every monster/NPC has a 2024 SRD attitude (Hostile / Indifferent / Friendly) on a gradual -5..+5
score. The DM moves it with `adjust_attitude {npc_id, delta, reason}` after meaningful
interactions; crossing a threshold changes the creature's side (foe / neutral / ally) and its place
in initiative. `set_disposition` stays the hard override and syncs the attitude.

## Notes
- Helpers in `packages/shared/src/attitude.ts`: `attitudeOf` (stored values, else derived from the
  flags: neutral 0, ally +3, foe -3; neutral wins over ally), `attitudeForScore` (<= -3 hostile,
  -2..+2 indifferent, >= +3 friendly), `dispositionForAttitude`, `attitudeForDisposition`,
  `formatAttitude` ("Friendly (+3)"), `defaultNpcVoice` (hash-picked descriptors, no LLM).
- Schema: `Monster.attitude?`, `attitudeScore?`, `voice?` are optional (no default) so old saves
  load and keep deriving from their flags.
- Engine: `applyDisposition` in `engine/tools.ts` is shared by set_disposition and adjust_attitude
  (flags + join/leave initiative). `syncAttitude` does set_disposition's sync: foe -> min(score,-3),
  neutral -> stored score clamped to -2..2 (0 when derived), ally -> max(score,3).
- adjust_attitude within a band: only the score moves, a log line, no moment. Across a threshold:
  log `<Name> is now Friendly (+3): <reason>` and a transient `attitude` moment (outcome = the new
  attitude) for the TV ring flash.
- Persona: SRD Influence (Willing / Unwilling / Hesitant; DC 15 or the creature's Intelligence,
  whichever is higher; Advantage if Friendly, Disadvantage if Hostile; 24 h no retry) and an
  "NPCs here" block listing every creature with a token and its attitude.
- Web: `lib/tokenColor.ts` `attitudeColor` / `monsterColor` (by attitudeOf; same colours as the
  old disposition colours), `lib/attitudeBadge.ts` ("🙂 Friendly +3"), host Board Monsters panel
  −/＋ buttons (adjust_attitude ±1, host reason), TV ally/foe list badges, `momentPlan.ringFlash`
  for the ring pulse. `momentForTable` drops attitude moments of hidden monsters (the chime would
  give an ambusher away).
- Neutral (indifferent) creatures are still on neither TV list, so their badge only shows on the
  ring colour and the host Board.
- add_npc: new NPCs get friendly/+3 (ally) or hostile/-3 (ally=false); a re-call with `ally` syncs.

## TODOs
- [ ] Live-test: does the DM call adjust_attitude on its own after gifts/insults, and with sensible
      deltas? Does it use Influence checks with the right DC? (see general/live-test-checklist.md)

## Completed
- 2026-10-20: Schema fields, attitude helpers, adjust_attitude tool, set_disposition sync,
  get_party_status attitude fields, persona Influence text and NPCs-here block, add_npc voice and
  default attitude.
- 2026-10-20: Web: attitude badge and -/+ buttons on the host Monsters panel, TV list badges,
  token ring colour per attitude and a ring flash on the `attitude` moment (ringFlash), hidden
  monsters' attitude moments filtered (momentForTable).
- 2026-10-20: Review fixes: "NPCs here" refreshed after adjust_attitude/set_disposition/add_npc/
  spawn_monster/remove_monster; adjust_attitude no longer kills a downed NPC (killDowned=false);
  add_npc default voice is defaultNpcVoice(name) like speak_as_npc's fallback; defaultNpcVoice
  components independently mixed (mix32). Bugs: npcs-here-list-stale, attitude-drift-kills-downed-npc,
  npc-default-voice-inconsistent.
