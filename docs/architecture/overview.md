---
title: System overview
area: architecture
topic: architecture
related_code:
  - apps/server/src/index.ts
  - apps/server/src/game/service.ts
  - apps/server/src/hub.ts
  - apps/server/src/config.ts
  - package.json
  - pnpm-workspace.yaml
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Auth module (access levels per route, sign-in cookie, table code); Hub stores each socket's access and clamps the hello role; online play config"
  - "2026-10-21: /table carries the voice call, /host is controls only; Hub reads roles and client events (bugs/closing-host-kills-dm)"
  - "2026-10-21: Entry point builds the app twice (app.ts buildApp): HTTP on PORT, HTTPS on HTTPS_PORT (tls.ts cert)"
  - "2026-10-20: AI players module (players/ai-player.ts)"
  - "2026-10-20: Party split service wiring (normalizeScenes, mapScene in stateAfterPaint)"
  - "2026-10-20: Reviewed for the character roster (service roster methods); see gameplay/character-roster.md"
  - "2026-09-24: Initial version (vertical slice)"
  - "2026-10-18: Spell and class catalogs in the diagram (rules engine)"
  - "2026-10-20: Phones (/player) in the diagram and packages table; host-action notes to the DM (hostNote.ts); brain timeout; background map prepaint; orchestrator notes"
---

# System overview

AI Dungeon Master runs a D&D 5e (2024, SRD 5.2) game at an in-person table. The AI DM talks out
loud through OpenAI's Realtime voice-to-voice model. The game state lives on a local Node server,
a TV shows the 3D map, tokens, dice, and party stats, and each player's phone can show their own
character sheet.

```
 Table mic + speaker ─WebRTC─► OpenAI Realtime (voice DM, semantic VAD, barge-in)
        │                             │ function calls
  /table browser tab                  ▼
        │ PCM16 16 kHz        Server sideband WebSocket (same session, ?call_id=)
        ▼                             │
  /ws/audio ──► SpeakerService ──► GameService ──► Tool engine (pure reducers)
                (voiceprints)          │  │  └──► Brain LLM (OpenAI | Anthropic)
                                       │  └─────► ImageService (maps, sprites, map prepaint)
                                       │  └─────► RulesIndex + Monster/Spell/Class catalogs (SRD 5.2)
                                       ▼
                               SQLite (Store) + campaigns/<id>/assets
                                       │ broadcast (Hub)
                     /ws ──► /host (controls), /table (TV), /player/:id (phones)
```

## Processes and packages

| Package | Path | Role |
|---|---|---|
| `@dm/shared` | `packages/shared` | Zod schemas (GameState, Character, …), tool definitions, events, and the dice notation roller. Shared by the server and web as TypeScript source (no build step). |
| `@dm/server` | `apps/server` | Fastify HTTP + `ws` sockets. It owns the authoritative state and all AI calls. Runs with `tsx`. |
| `@dm/web` | `apps/web` | React + Vite + React Three Fiber. `/host` is the laptop control screen, `/table` is the TV, and `/player/:id` is a player's phone sheet (`/player` picks one). |

In production, the server serves the built web app from `apps/web/dist`. In development, Vite runs
on :5173 and proxies `/api`, `/ws` and `/media` to the server on :8787.

## Key design decisions

- **The server is the single source of truth.** Every change goes through `GameService.runTool` or
  an explicit host override. The server persists to SQLite and then broadcasts the full `GameState`.
- **Host changes reach the DM.** When the host changes the game from `/host` or REST while a DM
  session is live, `game/hostNote.ts` builds a silent system note ("Host did: add_monster … Already
  done - don't repeat it") so the DM doesn't redo it. Fog strokes, token drags and map-feature
  edits are skipped. See [data-flow](data-flow.md).
- **Voice runs in the browser, and tools run on the server.** The `/table` page holds the WebRTC
  audio call and the table mic; `/host` only sends it commands, so the host tab can be closed mid-game
  (see [voice ownership](../server/voice-ownership.md)). The server creates that call with its API key (`POST /v1/realtime/calls`) and attaches a
  **sideband** WebSocket to the same session. That way the API key never reaches the browser, and
  every tool call runs next to the game state. See [realtime-sideband](../server/realtime-sideband.md).
- **Speaker identification happens between the turn and the response.** VAD runs with
  `create_response: false`, so after each user turn the server identifies the speaker from
  voiceprints, inserts a `[speaker: …]` system note, and then sends `response.create`. See
  [speaker-id](../server/speaker-id.md).
- **Two models.** The Realtime model talks and calls fast tools. A background "brain" LLM (OpenAI or
  Anthropic, configurable) writes the adventure, builds pregens, parses sheets, answers
  `consult_brain`, reads painted maps for features, and writes session recaps. Each brain request
  has a timeout (`BRAIN_TIMEOUT_MS`, default 15 minutes, one retry). See
  [brain-providers](../server/brain-providers.md).
- **Dice are authoritative on the server** (crypto RNG). The 3D dice replay a physics simulation
  and relabel faces so the face that lands up shows the server's number. See [dice-3d](../web/dice-3d.md).
- **Everything degrades gracefully.** With no OpenAI key, you still get manual play, rules search,
  dice, maps and the demo campaign. With no voice model, the DM asks who spoke, and the host can tap
  speaker buttons.

## Main modules

| Module | File | Notes |
|---|---|---|
| Entry point | `apps/server/src/index.ts`, `app.ts`, `tls.ts` | `buildApp` (Fastify, static web, `/media` images, `/ws` + `/ws/audio` upgrades) is built twice over one `GameService` and socket pair: HTTP on `PORT` and HTTPS on `HTTPS_PORT` (self-signed cert from `tls.ts`, or `HTTPS_CERT`/`HTTPS_KEY`) so a laptop host can use the mic. See [install and run](../setup/install-and-run.md#desktop-server--laptop-table) |
| Orchestrator | `apps/server/src/game/service.ts` | Loads campaigns and the SRD catalogs, runs tools (with host-action notes to the DM), speaker ID, DM session lifecycle, brain/image jobs, background map prepaint (`PREPAINT_MAPS`), undo history, resets and bundles |
| AI players | `apps/server/src/players/ai-player.ts` | Seats played by an LLM (`AI_PLAYER_*`): pick who acts after a DM reply, prompt with sheet + board + transcript, speak on `/table`, hand the line to the DM. See [AI players](../gameplay/ai-players.md) |
| Auth | `apps/server/src/auth/*`, `routes/auth.ts` | Access level per request (host / table / player / none) from the caller's address (`CF-Connecting-IP` marks tunnelled requests) and its signed cookie; table code, host password, seat claims in `DATA_DIR/auth.json`. See [authentication](../server/auth.md) and [online play](../setup/online-play.md) |
| Broadcast | `apps/server/src/hub.ts` | Sends a snapshot on connect, then fans out events. Stores each socket's access (from the upgrade), records its role from its `hello` (clamped to that access), passes client events (`voice_link`) to listeners, can send to one socket (`voice_command` to the table), and closes a signed-out player's sockets |
| Voice owner | `apps/server/src/game/voice-owner.ts` | Pure picks: which `/table` gets voice commands, which `/ws/audio` stream feeds voice ID, the `voice_owner` view. See [voice ownership](../server/voice-ownership.md) |
| Config | `apps/server/src/config.ts` | Env vars → typed config, with paths resolved from the repo root. Model names live only here and in `.env.example`. See [configuration](../setup/configuration.md) |

Related docs: [data-flow](data-flow.md), [state-model](state-model.md), [http-api](../server/http-api.md).
