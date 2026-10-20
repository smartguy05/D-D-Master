# TODO before play testing

Collected 2026-10-18 after the first live voice tests. All seven items were implemented on
2026-10-18 (one `wf/*` branch per stream, TDD, 2–3 rounds of adversarial review each). What is
left is **live testing at the table** — the items below say what to check. Details live in
`docs/` and `.memories/features/*`.

## Status

| # | Item | Status | Branch / docs |
|---|---|---|---|
| 1 | Missing D&D rules | Done | `wf/rules-data`, `wf/rules-engine`, `wf/rules-ui` · `docs/gameplay/rules-engine.md`, `docs/server/rules-data.md` |
| 2 | Host board fixing | Done | `wf/host-board` · `docs/web/host-ui.md` (Board tab) |
| 3 | Show that the voice call was lost | Done, needs live test | `wf/voice` · `docs/server/realtime-sideband.md` |
| 4 | Skip turns with no words | Done, needs live test + tuning | `wf/voice` · `docs/server/realtime-sideband.md` |
| 5 | Spawn layout | Done | `wf/spawn-layout` · `docs/server/tools-engine.md` |
| 6 | NPC voice overlap | Done, needs live test | `wf/voice` · `docs/server/realtime-sideband.md` |
| 7 | Animations for attacks and spells | Done, check on the real TV | `wf/animations` · `docs/web/table-display.md` |

## Live tests still to run (need the room, the mic and an API key)

- [ ] **Re-attach (3):** start a voice session, kill and restart the server mid-call. Expect the
  server to re-attach to the same call (tools work again) or, if that fails, the red
  "lost the voice call" banner with a working ↻ Reconnect.
- [ ] **Noise gate (4):** play with `TURN_GATE=on`, grep the server log for `[turn-timing]`, and
  pick `TURN_GATE_TIMEOUT_MS` from the committed→transcript times. Check that coughs and "uh"
  get no answer while "yes", "no", "mm-hmm" and spoken dice totals do. Watch for transcription
  hallucinations on noise ("Thank you.").
- [ ] **NPC voices (6):** `NPC_TTS=on`; the clip should start only after the DM stops and the DM
  should continue after the clip. Try a muted TV too (the DM waits the clip length).
- [ ] **Animations (7):** timing and loudness of swings, arrows, spell orbs, area rings and their
  sounds on the real TV.
- [ ] **Rules (1):** a full combat with a downed PC (death saves on its turn), a concentrating
  caster taking damage (physical and virtual dice), Short/Long Rest and a level-up from the host.

- [ ] **2026-10-19 features:** the attack swing lands after the damage dice (and a miss right
  after the d20) with the voice DM's real pacing; a crit/fumble flourish for 3D dice and for a physical
  roll marked natural on the phone; the join QR codes scan from a phone; the who's-talking pulse lights
  the right card mid-sentence (and how much CPU the live voice ID costs); the DM calls `npc_focus` before
  NPC lines and clears it; subtitle pace matches the DM's voice.

## Known limits (accepted, see the memories)

- Multiclassing, monster spell slots/concentration, walls and line of sight are out of scope.
- Spell recovery features (Arcane Recovery, Natural Recovery) are reminders, not automated.
- Cones and lines are drawn as approximate circles on the TV.
- Old forced-repaint map PNGs are not cleaned up from the assets folder.

## Findings from the 2026-10-19 browser test run

A full text-mode game in Chrome (no voice): campaign "Claude Test Run" (`cmp_cbe6567b3b`, kept),
3 players (form / sheet import / AI pregen), tavern → lighthouse (skeletons) → sea caves (kobolds,
Ogre boss) → tavern → a hand-added docks location, plus every host, TV and phone control. Each bug
has a file in `.memories/bugs/`; ✅ marks fixed ones.

### Bugs: break real play (fix first)

| Bug | File |
|---|---|
| ✅ Targeted attacks aren't checked against AC; the DM applied damage on 3 misses | `attack-hit-not-checked-against-ac.md` |
| ✅ Spell attack after `cast_spell` is refused (action spent twice); slot lost, spell unresolved | `spell-attack-refused-after-cast.md` |
| ✅ Host tool calls (Spawn, End combat, rests…) aren't told to the DM; it spawned the boss twice | `host-actions-not-told-to-dm.md` |
| ✅ Physical rolls from phone/host are recorded twice (4/4) | `physical-roll-recorded-twice.md` |

### Bugs: wrong results or lost work

| Bug | File |
|---|---|
| AI pregens lost when the host switches tabs mid-generation | `pregens-lost-on-tab-switch.md` |
| Pregen `spells` are prose sentences ("?" chips, no spell cards) | `pregen-spells-prose.md` |
| ✅ Two death saves in one turn (automatic + DM `death_save`) | `double-death-save-per-turn.md` |
| ✅ Spell conditions outlive the spell (Blessed after End Bless and a long rest) | `spell-conditions-outlive-concentration.md` |
| DM stalls mid tool chain on a player's turn; no nudge recovers it | `dm-stalls-mid-player-turn.md` |
| DM narrates without tools (items, spawns, next_turn, end_combat, gold split) | `dm-narrates-without-tools.md` |
| ✅ Story NPC allies die in one hit (Commoner 4 HP) and are removed | `ally-npc-dies-in-one-hit.md` |
| ✅ Build-one characters have no saving throw proficiencies | `form-character-no-save-proficiencies.md` |
| ✅ `roll_dice` accepts a removed roller (logged as a raw id) | `roll-dice-removed-roller.md` |

### Bugs: polish

| Bug | File |
|---|---|
| Brain calls slow (~6 min adventure, ~2–3 min pregens), no timeout | `brain-calls-slow-no-timeout.md` |
| Imported campaign gets the same name as the original | `imported-copy-same-name.md` |
| TV orb says "Listening" while the mic is muted | `tv-orb-listening-while-muted.md` |
| Board toolbar reflow, clipped feature labels, Reset panel beside the row | `host-ui-layout-nits.md` |

### Gaps: decisions needed

- [ ] **Damage for physical-dice players.** The DM rolls it virtually; `docs/gameplay/dice-modes.md`
  only covers checks, saves and attacks. Decide (ask for real damage dice, or always virtual) and
  document it.
- [x] **NPCs in combat.** Decided 2026-10-20: allies drop Unconscious at 0 HP; NPCs join initiative only with `combatant: true` (`add_npc`/`set_disposition`). Should allies join initiative automatically, and what happens at 0 HP?
  (see `ally-npc-dies-in-one-hit.md`)
- [x] **Spell effects as conditions.** Decided 2026-10-20: linked conditions (`conditionMeta`: source spell, concentration, duration). Free-text conditions have no duration or link to concentration;
  decide whether `cast_spell` owns common buffs (see `spell-conditions-outlive-concentration.md`).
- [x] **Friendly creatures from `spawn_monster`.** Done 2026-10-20: `set_disposition` tool + host Monsters-panel button. Tikk's kobolds turned friendly but stayed foes in the
  sidebar and joined initiative; there is no host control to mark a monster as an ally.
- [ ] **Gold rewards.** `adjust_gold` accepts fractions and the DM can't split a reward cleanly;
  consider `int()` plus a split helper.
- [ ] **After a reset no location is loaded** and the TV shows an empty board until *Go here* or the DM
  moves the party; decide whether reset should place the party at the first location.
- [ ] **Unvisited maps paint on arrival** (~1 min wait on the first visit); consider painting the
  next location in the background.

### Gaps: docs and memories

- [x] Fixed 2026-10-19: `docs/web/player-view.md` said "There is no QR code yet"; stale open TODOs
  for QR codes and player notes (`player-view`), live who's talking (`speaker-id`) and map features
  on /host (`campaign-gen`) removed (all had shipped).
- [ ] `python3 scripts/docs_index.py stale` flags 5 docs whose code changed after their last audit
  (`characters.md`, `rules-data.md`, `install-and-run.md`, `overview.md`, `README.md`).

### Environment note

A second dev server (`tsx` without watch) was listening on :8799 with the same `campaigns/dm.sqlite`
during the run. Two servers writing one SQLite file can overwrite each other's state; stop stray
instances before play-testing.
