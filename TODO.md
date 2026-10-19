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
