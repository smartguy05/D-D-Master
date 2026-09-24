---
title: HTTP and WebSocket API
area: server
topic: api
related_code:
  - apps/server/src/routes/**
  - apps/server/src/index.ts
  - apps/web/src/lib/api.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Added campaign-management routes (history, export/import, PUT outline)"
  - "2026-09-24: /api/dm/voice?resume=1, mp3 media, npc_speech"
  - "2026-09-24: Initial version"
  - "2026-09-24: Player phone + character builder routes; physical roll authorization"
---

# HTTP and WebSocket API

All REST routes live in `apps/server/src/routes/api.ts`, except the campaign-management routes, which
are in `routes/campaign.ts`. They take and return JSON, and any error
comes back as `{ "error": message }` with a 4xx status. The server binds `0.0.0.0:PORT`, so phones
and the TV browser on the LAN can connect. There is **no auth**: this is meant for a trusted home
network.

## Status and campaigns

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/status` | | Capabilities (`openai`, `brain`, `images`, `voiceId`, …), `dm` status, `campaignId` |
| GET | `/api/campaigns` | | `Campaign[]` |
| POST | `/api/campaigns` | `{name, premise?, partyLevel?}` | New campaign (it is also loaded) |
| POST | `/api/campaigns/:id/load` | | `{ok}` |
| DELETE | `/api/campaigns/:id` | | `{ok}` |
| POST | `/api/campaign/outline` | `{premise?, length?: one-shot\|short\|campaign}` | `Outline` (the brain) |
| POST | `/api/campaign/map` | `{locationId, force?}` | `{url}` |
| POST | `/api/campaign/end-session` | | `{summary}` |

## Campaign management

These are registered by `registerCampaignRoutes` (`routes/campaign.ts`). The behaviour is described
in [history and bundles](history-and-bundles.md).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/history?limit=` | | Newest-first `[{id, version, ts, label}]` for the loaded campaign (max 50) |
| POST | `/api/history/undo` | | `{ok, restored: {version, label}}`. Restores the state before the last labelled change. 400 if there is nothing to undo |
| POST | `/api/history/restore` | `{version}` | Same, for a specific snapshot; later snapshots are dropped |
| GET | `/api/campaigns/:id/export?events=0` | | `application/gzip` attachment `<slug>.dmc.json.gz`. `events=0` leaves out the event log |
| POST | `/api/campaigns/import` | Raw file (`application/gzip`, `application/octet-stream` or JSON), up to 200 MB | New `Campaign` with a fresh id (not loaded) |
| PUT | `/api/campaign/outline` | `Outline` | The saved `Outline`. Zod-validated; maps are kept unless `mapPrompt` changed; refreshes the running DM |

## Players, voice and characters

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/players` | `{name}` | |
| PATCH | `/api/players/:id` | `{name?, characterId?}` | Assign a character |
| DELETE | `/api/players/:id` | | Also deletes the voiceprint |
| POST | `/api/players/:id/enroll/start` | | Needs the mic streaming to `/ws/audio` |
| POST | `/api/players/:id/enroll/stop` | | `{ok, samples, message}`, plus a broadcast `enroll` event |
| POST | `/api/speaker` | `{playerId \| null}` | Host "who's speaking" override |
| POST | `/api/characters` | `{character: Partial<Character>, playerId?}` | Manual form or an accepted pregen |
| PATCH | `/api/characters/:id` | `Partial<Character>` | Host override, validated by zod |
| DELETE | `/api/characters/:id` | | |
| POST | `/api/characters/:id/sprite` | | Regenerate the sprite |
| POST | `/api/characters/pregens` | `{count, wishes}` | `CharacterDraft[]` (not added until accepted) |
| POST | `/api/characters/import` | `{sheet, playerId?}` | Parsed and added |

## Player phones and the character builder (`routes/player.ts`)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/player-urls` | | `{urls}`: LAN `http://<ip>:PORT/player` addresses for the Party tab hint |
| POST | `/api/players/:id/roll` | `{notation, label}` | Phone roll for a virtual-dice player. Runs `roll_dice` for their character (the TV animates it) and notes it to a running DM. Returns the roll summary plus `dmInformed` |
| POST | `/api/players/:id/physical-roll` | `{total}` | Only accepted when `pendingRoll` is this player's character. The total must be an integer from -20 to 200 |
| POST | `/api/players/:id/dice-mode` | `{diceMode}` | The only character field a phone can change |
| POST | `/api/builder/start` | `{playerId, level?}` | Starts the voice character builder and prompts a running DM. Returns the draft summary |
| PATCH | `/api/builder` | `{draft, level?}` | Host edits, merged like `draft_character_update` |
| POST | `/api/builder/finalize` | | Creates and assigns the character. Returns a 400 with the missing fields if the draft is incomplete |
| DELETE | `/api/builder` | | Cancels the build |

See [player view](../web/player-view.md) and [characters](../gameplay/characters.md).

## Play

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/tools/:name` | Tool args | Runs any [DM tool](../reference/tool-catalog.md) as the host. Returns `{result}` |
| POST | `/api/rolls/physical` | `{total, characterId?, playerId?}` | Records `pendingRoll` with the total a player called out, and tells the DM. `characterId` must match the pending roll if one exists. `playerId` restricts it to that player's own pending roll |
| POST | `/api/rules/search` | `{q}` | Top 8 rule chunks |
| GET | `/api/monsters` | | SRD monster names |
| POST | `/api/dm/voice` | SDP offer (`application/sdp`) | SDP answer; starts the voice DM. `?resume=1` (browser rebuilt a dropped call): the DM continues instead of greeting |
| POST | `/api/dm/text` | | Starts the text-only DM |
| POST | `/api/dm/stop` | | |
| POST | `/api/dm/say` | `{text, playerId?}` | Typed player message |
| POST | `/api/dm/whisper` | `{text}` | Private host instruction to the DM |

## Static routes and sockets

- `GET /media/:campaignId/:file` serves generated images (`.png`) and NPC voice clips (`.mp3`,
  `audio/mpeg`), cached as immutable.
- `GET /*` serves the built web app (`apps/web/dist`), with an SPA fallback to `index.html`.
- `WS /ws` is used by `/host`, `/table` and `/player` phones (`hello` role `host|table|player`). It carries server events (`ServerEvent` in `packages/shared/src/events.ts`): `state`,
  `campaign`, `roll`, `speaker`, `dm_status`, `job`, `enroll`, `error`, `npc_speech`. A snapshot is sent on connect.
- `WS /ws/audio` is inbound only: binary PCM16 mono at 16 kHz from the host mic, used for voice ID.
