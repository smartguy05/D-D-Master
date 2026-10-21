---
title: HTTP and WebSocket API
area: server
topic: api
related_code:
  - apps/server/src/routes/**
  - apps/server/src/index.ts
  - apps/server/src/app.ts
  - apps/server/src/app.test.ts
  - apps/web/src/lib/api.ts
created: 2026-09-24
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude
status: current
change_log:
  - "2026-10-21: POST /api/dm/voice/start and /reconnect (the call runs on /table); /api/dm/stop hangs up the table's call; voice_owner/voice_command/voice_link; /ws/audio?role (bugs/closing-host-kills-dm)"
  - "2026-10-21: POST /api/dm/voice?handover=1 (planned silent handover)"
  - "2026-10-21: HTTPS listener on HTTPS_PORT (buildApp factory, shared sockets); player-urls hostUrls; DELETE/load of campaign id roster answers 400"
  - "2026-10-20: AI player fields on POST/PATCH /api/players, POST /api/players/:id/ai/nudge"
  - "2026-10-20: PATCH /api/campaign/settings; deathRule on create"
  - "2026-10-20: Character roster routes (GET/POST save, save-all, join, DELETE /api/roster)"
  - "2026-10-19: POST /api/campaigns/:id/reset"
  - "2026-10-19: POST /api/mic and /api/players/:id/mic; mic event"
  - "2026-10-19: npc_focus and caption events"
  - "2026-10-19: talk event"
  - "2026-10-19: player-urls: PUBLIC_URL first, preferred flag"
  - "2026-10-19: GET/PUT /api/players/:id/notes"
  - "2026-10-19: GET /players/:id/spells returns atLevels"
  - "2026-10-19: physical-roll takes natural (1 or 20)"
  - "2026-10-18: GET /api/players/:id/spells (phone spell cards)"
  - "2026-09-24: Added campaign-management routes (history, export/import, PUT outline)"
  - "2026-09-24: /api/dm/voice?resume=1, mp3 media, npc_speech"
  - "2026-09-24: Initial version"
  - "2026-09-24: Player phone + character builder routes; physical roll authorization"
  - "2026-10-18: POST /api/dm/stop-talking"
  - "2026-10-18: POST /api/npc/clip-ended"
  - "2026-10-18: clip-ended: muted tables do not report"
---

# HTTP and WebSocket API

All REST routes live in `apps/server/src/routes/api.ts`, except the campaign-management routes, which
are in `routes/campaign.ts`. They take and return JSON, and any error
comes back as `{ "error": message }` with a 4xx status. The server binds `0.0.0.0:PORT`, so phones
and the TV browser on the LAN can connect.

**Two listeners.** `apps/server/src/app.ts` `buildApp(game, {sockets, https?})` builds one Fastify
instance with every route, `/media`, the web app and the `/ws` + `/ws/audio` upgrades. `index.ts`
builds it twice over one `GameService` and one pair of socket servers (`createSockets`): plain HTTP
on `PORT` (8787) and HTTPS on `HTTPS_PORT` (8443, `0` = off). The HTTPS certificate comes from
`tls.ts` `loadOrCreateCert` (`HTTPS_CERT` + `HTTPS_KEY`, else a self-signed one in
`DATA_DIR/certs`). Browsers allow the mic only on https or localhost, so a laptop running `/host`
and `/table` against a desktop server uses the HTTPS port; phones stay on HTTP. If the HTTPS listener can't
start, the server logs a warning and runs on HTTP only. There is **no auth**: this is meant for a trusted home
network.

## Status and campaigns

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/status` | | Capabilities (`openai`, `brain`, `images`, `voiceId`, …), `dm` status, `campaignId` |
| GET | `/api/campaigns` | | `Campaign[]` |
| POST | `/api/campaigns` | `{name, premise?, partyLevel?, deathRule?}` | New campaign (it is also loaded) |
| PATCH | `/api/campaign/settings` | `{deathRule?: party_wipe\|any_death}` | The current `Campaign` (saved, broadcast as `campaign`, and the DM's instructions refreshed) |
| POST | `/api/campaigns/:id/load` | | `{ok}` |
| DELETE | `/api/campaigns/:id` | | `{ok}`. The id `roster` is refused with 400 (`<dataDir>/roster` holds the roster portraits); `load` refuses it too |
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
| POST | `/api/campaigns/:id/reset` | `{keepOutline?, keepPlayers?, keepCharacters?}` (each defaults to `true`) | `{ok}`. Start over: see [history and bundles](history-and-bundles.md#reset-start-over). Not undoable |
| POST | `/api/campaigns/import` | Raw file (`application/gzip`, `application/octet-stream` or JSON), up to 200 MB | New `Campaign` with a fresh id (not loaded) |
| PUT | `/api/campaign/outline` | `Outline` | The saved `Outline`. Zod-validated; maps are kept unless `mapPrompt` changed; refreshes the running DM |

## Character roster (`routes/roster.ts`)

The global roster of heroes that outlive a campaign (see [character roster](../gameplay/character-roster.md)).
`registerRosterRoutes` is called from `registerApi`.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/roster` | | `RosterEntry[]`, newest first. Works with no campaign loaded |
| POST | `/api/roster/save/:characterId` | | `{rosterId, created}`: saves (or updates) that character of the loaded campaign and links its `rosterId` |
| POST | `/api/roster/save-all` | | `{saved: {characterId, rosterId, created}[]}` for every character in the campaign |
| POST | `/api/roster/:id/join` | `{playerId?}` | The new `Character` added to the loaded campaign (new id, full HP, linked player, voiceprint and portrait copied). 400 when the hero is already in the campaign or the player already plays someone |
| DELETE | `/api/roster/:id` | | `{ok: true}`; removes the hero, its roster voiceprint and portrait |

## Players, voice and characters

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/players` | `{name, ai?}` | `ai: true` adds an [AI player](../gameplay/ai-players.md) (voice assigned) |
| PATCH | `/api/players/:id` | `{name?, characterId?, ai?, aiPersona?, aiPaused?}` | Assign a character; AI toggle, persona, pause. Other keys are ignored |
| POST | `/api/players/:id/ai/nudge` | | The AI player says or does something now: `{ok}` or `{ok:false, error}` (not AI, paused, no character, DM off, busy) |
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
| GET | `/api/player-urls` | | `{urls, preferred, hostUrls}`: `PUBLIC_URL/player` first when set (`preferred: true`), then LAN `http://<ip>:PORT/player` addresses (`lanUrls`; Docker/VM bridges last). `hostUrls`: `https://<ip>:HTTPS_PORT/host` for a laptop host (empty when HTTPS is off). Used by the Party tab link/QR codes and the TV join QR (`web/src/lib/join.ts`) |
| POST | `/api/players/:id/roll` | `{notation, label}` | Phone roll for a virtual-dice player. Runs `roll_dice` for their character (the TV animates it) and notes it to a running DM. Returns the roll summary plus `dmInformed` |
| POST | `/api/players/:id/physical-roll` | `{total, natural?}` | Only accepted when `pendingRoll` is this player's character. The total must be an integer from -20 to 200; `natural` must be 1 or 20 |
| GET | `/api/players/:id/notes` | | `{text, updatedAt}` (empty text and 0 when never saved): that player's private notes for the current campaign |
| PUT | `/api/players/:id/notes` | `{text}` | Saves the notes (string, max 20 000 characters) → `{updatedAt}`. Stored in SQLite `player_notes`, never in the game state or DM context |
| GET | `/api/players/:id/spells` | | `{spells: SpellChipInfo[]}`: read-only cards for that player's own `spells`, in sheet order: `{name, known, srdName?, level, school, concentration, ritual, castingTime, range, duration, summary, atLevels?}` from the SRD `SpellCatalog` (`atLevels`: `SpellLevelRow[]` from `engine/rules/cast.ts` `spellLevelRows`) (`find`: aliases and unique fuzzy matches). Unknown spells are `{name, known: false}`. Built by `spellSummaries` in `game/player.ts` |
| POST | `/api/players/:id/dice-mode` | `{diceMode}` | The only character field a phone can change |
| POST | `/api/players/:id/mic` | `{muted}` | `{muted}`; table mic mute from a phone (the log names the player) |
| POST | `/api/builder/start` | `{playerId, level?}` | Starts the voice character builder and prompts a running DM. Returns the draft summary |
| PATCH | `/api/builder` | `{draft, level?}` | Host edits, merged like `draft_character_update` |
| POST | `/api/builder/finalize` | | Creates and assigns the character. Returns a 400 with the missing fields if the draft is incomplete |
| DELETE | `/api/builder` | | Cancels the build |

See [player view](../web/player-view.md) and [characters](../gameplay/characters.md).

## Play

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/tools/:name` | Tool args | Runs any [DM tool](../reference/tool-catalog.md) as the host. Returns `{result}` |
| POST | `/api/rolls/physical` | `{total, natural?, characterId?, playerId?}` | Records `pendingRoll` with the total a player called out, and tells the DM. `characterId` must match the pending roll if one exists. `playerId` restricts it to that player's own pending roll |
| POST | `/api/rules/search` | `{q}` | Top 8 rule chunks |
| GET | `/api/monsters` | | SRD monster names |
| POST | `/api/dm/voice/start` | | `{ok}`; host **Start voice**: sends `voice_command start` to the `/table` screen that carries the call, which then POSTs its offer to `/api/dm/voice`. 400 "Open the table screen (/table) first…" when none is open, or without `OPENAI_API_KEY`. See [voice ownership](voice-ownership.md) |
| POST | `/api/dm/voice/reconnect` | | `{ok}`; host **Reconnect**: `voice_command reconnect` to the table (it rebuilds or resumes its call with `?resume=1`) |
| POST | `/api/dm/voice` | SDP offer (`application/sdp`) | SDP answer; starts the voice DM. Posted by `/table` (`VoiceLink`). `?resume=1` (browser rebuilt a dropped call): the DM continues instead of greeting. `?handover=1` (after a `voice_handover` prepare): builds a standby call next to the live one; see [voice handover](voice-handover.md) |
| POST | `/api/dm/text` | | Starts the text-only DM |
| POST | `/api/dm/stop` | | Stops the DM and sends `voice_command stop` to the table, which hangs up its call |
| POST | `/api/dm/stop-talking` | | `{stopped}`; cuts the DM off mid-sentence (cancel response, clear WebRTC audio, drop the queued reply). 400 if the DM isn't running |
| POST | `/api/mic` | `{muted}` | `{muted}`; table mic hard mute (host button/hotkey, TV key). Broadcasts `{type:"mic"}`; see [realtime-sideband](realtime-sideband.md#table-mic-mute-setmicmuted) |
| POST | `/api/npc/clip-ended` | `{url}` | `{ok}`; `/table` reports that the playing `speak_as_npc` clip ended or failed (a muted table never reports; the server times out instead). Frees the NPC clip queue so the DM continues; `ok:false` if that clip isn't the one playing (e.g. a second table) |
| POST | `/api/dm/say` | `{text, playerId?}` | Typed player message |
| POST | `/api/dm/whisper` | `{text}` | Private host instruction to the DM |

## Static routes and sockets

- `GET /media/:campaignId/:file` serves generated images (`.png`) and NPC voice clips (`.mp3`,
  `audio/mpeg`), cached as immutable.
- `GET /*` serves the built web app (`apps/web/dist`), with an SPA fallback to `index.html`.
- `WS /ws` is used by `/host`, `/table` and `/player` phones (`hello` role `host|table|player`; the
  `Hub` records it). It carries server events (`ServerEvent` in `packages/shared/src/events.ts`): `state`,
  `campaign`, `roll`, `speaker`, `talk`, `dm_status`, `mic`, `job`, `enroll`, `error`, `npc_speech`, `npc_focus`,
  `caption`, `voice_owner`, `voice_handover`, and `voice_command` (only to the owner table). A
  snapshot is sent on connect. Clients send `hello`, `ping` and, from `/table`, `voice_link`.
- `WS /ws/audio?role=host|table` (default `table`) is inbound only: binary PCM16 mono at 16 kHz,
  used for voice ID. The `/table` mic feeds it during play, the `/host` mic while a voice is
  enrolled (`pickAudioSource`); chunks from the other source are dropped. Frames are dropped while
  the table mic is muted.
