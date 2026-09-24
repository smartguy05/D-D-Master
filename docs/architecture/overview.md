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
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version (vertical slice)"
---

# System overview

AI Dungeon Master runs a D&D 5e (2024, SRD 5.2) game at an in-person table. The AI DM talks out
loud through OpenAI's Realtime voice-to-voice model. The game state lives on a local Node server,
and a TV shows the 3D map, tokens, dice, and party stats.

```
 Table mic + speaker ─WebRTC─► OpenAI Realtime (voice DM, semantic VAD, barge-in)
        │                             │ function calls
  /host browser tab                   ▼
        │ PCM16 16 kHz        Server sideband WebSocket (same session, ?call_id=)
        ▼                             │
  /ws/audio ──► SpeakerService ──► GameService ──► Tool engine (pure reducers)
                (voiceprints)          │  │  └──► Brain LLM (OpenAI | Anthropic)
                                       │  └─────► ImageService (maps, sprites)
                                       │  └─────► RulesIndex + MonsterCatalog (SRD 5.2)
                                       ▼
                               SQLite (Store) + campaigns/<id>/assets
                                       │ broadcast (Hub)
                     /ws ──► /host (controls) and /table (TV)
```

## Processes and packages

| Package | Path | Role |
|---|---|---|
| `@dm/shared` | `packages/shared` | Zod schemas (GameState, Character, …), tool definitions, events, and the dice notation roller. Shared by the server and web as TypeScript source (no build step). |
| `@dm/server` | `apps/server` | Fastify HTTP + `ws` sockets. It owns the authoritative state and all AI calls. Runs with `tsx`. |
| `@dm/web` | `apps/web` | React + Vite + React Three Fiber. `/host` is the laptop control screen and `/table` is the TV. |

In production, the server serves the built web app from `apps/web/dist`. In development, Vite runs
on :5173 and proxies `/api`, `/ws` and `/media` to the server on :8787.

## Key design decisions

- **The server is the single source of truth.** Every change goes through `GameService.runTool` or
  an explicit host override. The server persists to SQLite and then broadcasts the full `GameState`.
- **Voice runs in the browser, and tools run on the server.** The browser holds the WebRTC audio
  call. The server creates that call with its API key (`POST /v1/realtime/calls`) and attaches a
  **sideband** WebSocket to the same session. That way the API key never reaches the browser, and
  every tool call runs next to the game state. See [realtime-sideband](../server/realtime-sideband.md).
- **Speaker identification happens between the turn and the response.** VAD runs with
  `create_response: false`, so after each user turn the server identifies the speaker from
  voiceprints, inserts a `[speaker: …]` system note, and then sends `response.create`. See
  [speaker-id](../server/speaker-id.md).
- **Two models.** The Realtime model talks and calls fast tools. A background "brain" LLM (OpenAI or
  Anthropic, configurable) writes the adventure, builds pregens, parses sheets, answers
  `consult_brain`, and writes session recaps. See [brain-providers](../server/brain-providers.md).
- **Dice are authoritative on the server** (crypto RNG). The 3D dice replay a physics simulation
  and relabel faces so the face that lands up shows the server's number. See [dice-3d](../web/dice-3d.md).
- **Everything degrades gracefully.** With no OpenAI key, you still get manual play, rules search,
  dice, maps and the demo campaign. With no voice model, the DM asks who spoke, and the host can tap
  speaker buttons.

## Main modules

| Module | File | Notes |
|---|---|---|
| Entry point | `apps/server/src/index.ts` | Fastify, static web, `/media` images, `/ws` + `/ws/audio` upgrades |
| Orchestrator | `apps/server/src/game/service.ts` | Loads campaigns, runs tools, speaker ID, DM session lifecycle, jobs |
| Broadcast | `apps/server/src/hub.ts` | Sends a snapshot on connect, then fans out events |
| Config | `apps/server/src/config.ts` | Env vars → typed config, with paths resolved from the repo root |

Related docs: [data-flow](data-flow.md), [state-model](state-model.md), [http-api](../server/http-api.md).
