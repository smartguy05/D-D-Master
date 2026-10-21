---
title: Testing
area: setup
topic: testing
related_code:
  - vitest.config.ts
  - "**/*.test.ts"
  - apps/server/src/scripts/eval-voiceid.ts
created: 2026-09-24
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Debugging recipes: log tags, event-log mining, direct tool calls, timed screenshots, fault injection, file mtimes"
  - "2026-10-21: Table voice call and AI floor suite (hub, voice-owner, service.table-voice, voicePlan, busy/interrupt)"
  - "2026-10-21: Timeouts, HTTPS and roster guard suite (config, provider, service.consult, images, tls, app, player, roster)"
  - "2026-10-21: Web audio and voice link suite (audioUnlock, npcAudio NotAllowedError, VoiceLink handover, MicStreamer reconnect, clipSpeaker)"
  - "2026-10-20: Character roster suite"
  - "2026-10-20: Walls, doors and line of sight suite"
  - "2026-10-19: Turn economy suite"
  - "2026-09-24: Initial version (51 tests)"
  - "2026-10-18: Added map prompt test"
  - "2026-10-18: Added map feature tests"
  - "2026-10-18: Host board tests"
  - "2026-10-18: Host board review tests"
  - "2026-10-18: Rules engine test suites"
  - "2026-10-19: fogStatus.test.ts (location fog badge)"
---

# Testing

The project follows a test-first rule: every engine, parsing or matching change comes with a
Vitest test.

```bash
pnpm test            # all unit tests (vitest, root config)
pnpm typecheck       # tsc for shared, server and web
pnpm docs:check      # docs audit + index freshness
```

| Suite | File | Covers |
|---|---|---|
| Dice notation | `packages/shared/src/dice.test.ts` | Parsing, keep-high/low, bounds |
| Tool schemas | `packages/shared/src/tools.test.ts` | Every tool exported as a JSON-schema function with required args |
| Engine | `apps/server/src/engine/tools.test.ts` | HP, temp HP, conditions, items, gold, rolls, spawns, initiative, scenes, tokens |
| Rules and SRD | `apps/server/src/rules/rules.test.ts` | Chunking, lookups and stat-block parsing against the real SRD |
| Voiceprints | `apps/server/src/speaker/voiceprint.test.ts` | Matching, ambiguity, running mean, ring buffer, silence trim |
| Realtime loop | `apps/server/src/realtime/session.test.ts` | Speaker note before `response.create`, parallel tool calls and outputs, error passthrough, response queueing, transcripts |
| Brain JSON | `apps/server/src/brain/provider.test.ts` | JSON extraction and the one-retry repair loop |
| Map prompt | `apps/server/src/images/index.test.ts` | Map orientation contract (entrance left, focal feature right) |
| Map features | `packages/shared/src/features.test.ts`, `apps/server/src/engine/map-features.test.ts`, `apps/server/src/brain/map-features.test.ts` | Box → cell conversion, entry/spawn cells, lit glow, restage after repaint, vision request |
| Host board | `apps/server/src/engine/board.test.ts`, `apps/server/src/game/service.board.test.ts`, `apps/web/src/host/board/geometry.test.ts`, `apps/web/src/table/visibility.test.ts`, `apps/web/src/host/fogStatus.test.ts`, `apps/server/src/brain/consult.test.ts`, `apps/server/src/images/index.test.ts` | Fog hide/reveal vs auto-reveal, feature edits, `expect_name`, forced repaint (fresh picture, edits and fog reset, undoable), hidden monsters act and are flagged, host-only tool guard, undo, instruction refresh, old saves, board geometry, TV visibility, location fog badge |
| Rules engine | `apps/server/src/engine/rules/{derive,vitals,cast,rests,level}.test.ts`, `packages/shared/src/schemas.rules.test.ts`, `apps/server/src/game/service.rules.test.ts`, `apps/server/src/realtime/instructions.test.ts` | Slots/hit dice/resources derived from the SRD tables, old-save upgrade, death saves (nat 20/1, crit, massive damage, heal), concentration checks and the pending-roll policy, `cast_spell` (Fireball at 3 and 5, Fire Bolt scaling, rituals, Pact Magic, Mystic Arcanum), rests, `level_up` 1→2→3 with subclass, purity, compact instructions. `engine/rules/testing.ts` gives an `EngineContext` on the real catalogs |
| Turn economy | `apps/server/src/engine/economy.test.ts`, `packages/shared/src/turn.test.ts`, `apps/server/src/rules/rules.test.ts` | Movement vs Speed and Dash, off-turn refusals, reactions per round, Extra Attack and Multiattack, Action Surge override, spell casting times, host/out-of-combat exemptions, budget chips, SRD Speed and Multiattack parsing |
| Character roster | `packages/shared/src/schemas.roster.test.ts`, `apps/server/src/db/roster.test.ts`, `apps/server/src/game/{roster,service.roster,service.moments,reset,bundle}.test.ts`, `apps/server/src/routes/roster.test.ts`, `apps/web/src/host/roster.test.ts` | Schema defaults and old saves, roster tables and cascade, snapshot resets, portrait copy, save/link without undo, voiceprint copy both ways, join player matching and refusals, full round trip across campaigns, end_campaign auto-save, bundles keep rosterId without touching the roster, routes via `app.inject`, host labels and end prompt |
| Walls, doors, line of sight | `packages/shared/src/los.test.ts`, `packages/shared/src/features.test.ts`, `apps/server/src/engine/{fog,attack-rules,board,spawn,tools}.test.ts`, `apps/server/src/engine/rules/cast.test.ts`, `apps/server/src/brain/map-features.test.ts`, `apps/server/src/realtime/instructions.test.ts`, `apps/web/src/host/board/geometry.test.ts`, `apps/web/src/table/{doors,visibility}.test.ts` | `blocksSight`/`blocksMove`, corner-to-corner sight, cover levels, `visibleCells` fog, `moveBlocked`, `wallsFromLines` snapping, LOS fog reveal, attack refusal and +2/+5 cover (log note), area-spell LOS, DM move refusal, `set_door`/`edit_walls`, hidden spawns behind walls, wall editor geometry, TV door transform and fog visibility |
| Table voice call and AI floor | `apps/server/src/{hub,game/voice-owner,game/service.table-voice}.test.ts`, `apps/web/src/table/voicePlan.test.ts`, `apps/web/src/lib/voice.test.ts` (resume, `audioSocketUrl`), `apps/server/src/realtime/{session,npc-queue}.test.ts`, `apps/server/src/players/ai-player.test.ts`, `apps/server/src/game/service.ai-players.test.ts` | Hub roles and per-socket send, owner/audio-source picks, Start/Stop/Reconnect reach only the owner table, audio filtered while enrolling, auto-resume truth table; `DmSession.busy`/`onResponseStart`, pc clips wait on a busy DM and drop after 15 s, `started`, AI interrupts drop unheard lines without spending the turn, hold from clip start |
| Web audio and voice link | `apps/web/src/lib/{audioUnlock,npcAudio,voice}.test.ts`, `apps/web/src/table/caption.test.ts` | TV autoplay lock (unlock needs both the context and a silent clip, step timeout, re-lock after a blocked clip, stale attempts), NPC clip `NotAllowedError` → `onBlocked` and still reported as ended, `VoiceLink` reconnect and planned handover with fake peers (muted standby, swap unmutes, plays the new stream and closes the old peer, abort, failed offer, reconnect/stop cancel), `MicStreamer` `/ws/audio` backoff reconnect and `stop()`, `clipSpeaker` keeps the focused NPC's portrait |
| Timeouts, HTTPS, roster guard | `apps/server/src/config.test.ts`, `apps/server/src/brain/provider.test.ts`, `apps/server/src/game/service.consult.test.ts`, `apps/server/src/images/index.test.ts`, `apps/server/src/tls.test.ts`, `apps/server/src/app.test.ts`, `apps/server/src/routes/{player,roster}.test.ts`, `apps/server/src/game/service.roster.test.ts` | `CONSULT_TIMEOUT_MS`/`IMAGE_TIMEOUT_MS`/`HTTPS_PORT` parsing, `createConsultProvider` timeout, a consult timeout becomes the improvise result, a stalled image request rejects and aborts at the deadline, self-signed cert made once with LAN SANs and remade for a new IP or near expiry, user cert wins, HTTP and HTTPS listeners serve the API and `/ws` from one game, `hostUrls`, campaign id `roster` refused (400) and roster portraits survive |
| 3D dice | `apps/web/src/dice/dice.test.ts` | Geometry, d10 planarity, **every value lands up after physics**, d100 mapping |

## Integration checks

- **Voice-ID accuracy**: `bash scripts/download-models.sh --with-tts`, then
  `pnpm --filter @dm/server eval:voiceid`. This enrolls 6 synthetic voices from one sentence each
  and identifies 30 new sentences. Result on 2026-09-24: 30/30.
- **Visual check**: seed the demo, then `pnpm build && pnpm start`. Open `/table`, and from `/host`
  roll `1d20+1d12+1d10+1d8+1d6+1d4+5`. You should see dice fly and settle, then a toast whose total
  matches. Headless Chromium works with `--use-angle=swiftshader`.
- **Live voice** (needs a key and a human): enroll 2–3 voices, start the voice DM, talk without
  saying names, and interrupt the DM mid-sentence. Then roll an attack (virtual and physical), take
  damage, pick up an item, end the session, restart, and resume to hear the recap.

## Debugging recipes

These come from past bug hunts (`.memories/bugs/`). The classes of bugs they found are in
[design rules](../architecture/design-rules.md).

- **Grep the server log by tag.**

  | Tag | Source | Meaning |
  |---|---|---|
  | `[tool] name(id) -> error` | `realtime/session.ts` | A refused or failed tool call (walls, turn economy, scene focus, move cap, ready check, thrown error). Look here first when "the DM stopped moving tokens" |
  | `[moves]` | `realtime/session.ts` | A `move_token` refused by the per-reply move cap |
  | `[turn-timing]` | `realtime/session.ts` | Noise-gate decision and latency per mic turn ([realtime audio and turns](../server/realtime-audio-and-turns.md)) |
  | `[echo]` | `realtime/session.ts` | A voice turn dropped because a table clip was playing |
  | `[ai]` | `players/ai-player.ts` | An AI player line that was dropped, and why |
  | `[handover]` | `game/service.ts` | Planned Realtime call handover |
- **Mine an exported event log.** `GET /api/campaigns/:id/export` (events are included unless you
  pass `events=0`) gives the whole log. Cite bugs by campaign id and event numbers, for example
  "events 343/344", so the exact tool sequence can be replayed in a unit test.
- **Call tools directly.** `POST /api/tools/<name>` runs any DM tool as the host against a demo
  seed (`DATA_DIR=<tmp> pnpm --filter @dm/server seed:demo`). This reproduces engine and TV issues
  without a voice session.
- **Take timed screenshots of the TV.** Playwright with `executablePath: /opt/pw-browsers/chromium`
  and `--use-angle=swiftshader --enable-unsafe-swiftshader`. Use 1600×900 for `/table` and
  390×844 for `/player`. Shoot at fixed delays after an action (for example 150 ms and 400 ms) to
  catch ordering bugs. Headless swiftshader runs at a low frame rate, which can expose frame-clock
  bugs (bugs/dice-playback-clock-cap), but it is too slow to judge animation timing. Google Fonts
  fail there; that is harmless.
- **Inject faults in unit tests.** Use a hanging `audio.speech.create`, a socket dropped before a
  tool resolves, or `close()` before `open`. The realtime socket factory (`createSocket`) and the
  `VoiceLinkDeps` are injectable for this.
- **Use file timestamps as evidence.** NPC and AI player clips are cached as
  `<DATA_DIR>/<campaignId>/assets/npc_<hash>.mp3`. Gaps in their mtimes showed a 6-minute speech
  synthesis stall (bugs/ai-player-goes-mute).
- **Write one regression test per bug, next to the code.** Name the bug or review round in the
  test, as in `service.board.test.ts` and `momentPlan.test.ts`.
