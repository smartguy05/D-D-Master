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
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Phone creation routes (roster, creation draft, chat, host approval), campaign settings partyLevel/creation, creation-lock"
  - "2026-10-22: hosts/revoke closes every host-cookie socket (WS_RECONNECT) and re-issues the caller's cookie with a fresh sid"
  - "2026-10-22: POST /api/auth/hosts/revoke; host logout revokes host cookies; player-urls needs table access; /ws heartbeat"
  - "2026-10-22: POST /api/players/:id/mic needs table access (no remote seats)"
  - "2026-10-22: Phase 5: /ws maxPayload 256 KB and the Hub message cap; rtc/peers events (online-call.md)"
  - "2026-10-22: Phase 5: /api/rtc/config feeds the online call"
  - "2026-10-22: /api/dm/say: SAY_MAX caps only seat-bound callers; a send that failed (DM down) does not use the throttle slot"
  - "2026-10-22: /api/dm/say caps text (SAY_MAX), throttles seat-bound callers (SAY_MIN_GAP_MS) and refuses typing over another holder of the floor"
  - "2026-10-22: POST /api/floor/release (host); ptt press throttle and in-room by origin on /ws"
  - "2026-10-22: POST /api/push-to-talk (host); floor ServerEvent and ptt ClientEvent on /ws"
  - "2026-10-22: /ws snapshot after hello for host/table; player sockets get the public projection; phone roll replies trimmed"
  - "2026-10-22: Online card and auth review fixes: ONLINE_URL for the invite link, seat takeover, rate limits per /64 plus a global budget"
  - "2026-10-22: Access levels per route (auth/access.ts), sign-in routes /api/auth/*, GET /api/rtc/config, /api/dm/say seat check, WebSocket upgrade checks (Origin, access, hello clamp)"
  - "2026-10-21: POST /api/mic takes source (host-key, host-button, table-key) for the mic diag event"
  - "2026-10-21: Media URL rules: /media vs /assets, immutable caching and versioned URLs, wildcard static; mic mute link points to realtime-audio-and-turns.md"
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
builds it twice over one `GameService` and one pair of socket servers (`createSockets`; `/ws` frames
are capped at 256 KB and the Hub drops client messages over 64 KB, the biggest being an
[online call](../web/online-call.md) offer): plain HTTP
on `PORT` (8787) and HTTPS on `HTTPS_PORT` (8443, `0` = off). The HTTPS certificate comes from
`tls.ts` `loadOrCreateCert` (`HTTPS_CERT` + `HTTPS_KEY`, else a self-signed one in
`DATA_DIR/certs`). Browsers allow the mic only on https or localhost, so a laptop running `/host`
and `/table` against a desktop server uses the HTTPS port; phones stay on HTTP. If the HTTPS listener can't
start, the server logs a warning and runs on HTTP only.

**Access.** Every route needs an access level: `host`, `table`, `player` (a table-code cookie, its own
seat only) or public. Everything under `/api` is **host-only unless listed** in `auth/access.ts`
(`routeNeed`); the tables below say "player" or "table" where that applies. Too low a level answers
`401 {error}`; a player on another seat's route gets `403`; a non-GET request whose `Origin` names
another site gets `403`. A browser on this machine is the host and the home network is `table`
by default. See [authentication](auth.md).

## Sign-in

`routes/auth.ts`. Wrong codes and passwords count per address (IPv6 per /64): 10 in 10 minutes, or 100 from all addresses together, answer `429` with `retry-after`.

| Method | Path | Access | Body | Returns |
|---|---|---|---|---|
| GET | `/api/auth/me` | public | | `{level, playerId?, origin: local\|lan\|remote, hostLogin}` |
| POST | `/api/auth/host` | public | `{password}` | `{ok, level}` and the host cookie. 401 wrong password; 403 when `HOST_PASSWORD` is empty |
| POST | `/api/auth/join` | public | `{code}` | `{ok, seats}` and a player cookie not bound to a seat yet (an existing valid player cookie is kept). 401 wrong code |
| GET | `/api/auth/claim` | player | | `{seats: [{id, name, character?, claimed, mine}]}`: the loaded campaign's human seats |
| POST | `/api/auth/claim` | player | `{playerId}` | `{ok, playerId}`; binds the cookie to that seat (new cookie). 409 when another sign-in holds it and has had a socket open in the last 2 minutes (else the seat is taken over); 400 for an unknown or AI seat. Host and LAN callers need no binding (`ok` without a cookie) |
| POST | `/api/auth/logout` | public | | `{ok}`; frees the caller's seat, closes its sockets, clears the cookie. With a host cookie it also bumps the host generation: every host cookie dies and every host-cookie socket closes |
| POST | `/api/auth/hosts/revoke` | host | | `{ok, closed}`; "Sign out other host devices": bumps the host generation, closes every host-cookie socket, the caller's too, with code 4012 so its tabs reconnect, and re-issues the caller's host cookie with a fresh sid (none for the local bypass) |
| POST | `/api/auth/code/rotate` | host | | `{code}`; new code, every player cookie dies, their sockets close. 400 when `TABLE_CODE` is set |
| POST | `/api/auth/kick` | host | `{playerId}` | `{ok, released, closed}`; frees the seat (its cookie stops working) and closes its sockets |
| GET | `/api/auth/sessions` | host | | `{code, fixedCode, onlineUrl, invitePath, hostLogin, trustLan, seats: [{playerId, name, character?, claimed, claimedAt?, connected}]}` for the Online card |

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

`PATCH /api/campaign/settings` takes `{deathRule?, partyLevel?, creation?}` (`creation`: `CreationSettings` fields except `playStartedAt`); `POST /api/campaign/creation-lock {locked}` sets or clears the phone edit lock ([phone creation](../gameplay/phone-creation.md)).

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

The `/api/players/:id/*` routes below (roll, physical-roll, notes, spells, dice-mode, roster, creation) need
player access **for that seat**: a table-code cookie bound to `:id`, or the host or the LAN.
`/api/players/:id/mic` needs table access (the host or a LAN phone): it mutes the whole room's mic,
so a remote player can't. The builder routes are host-only.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/player-urls` | | Table access (the LAN, the host; not tunnelled players). `{urls, preferred, hostUrls}`: `PUBLIC_URL/player` first when set (`preferred: true`), then LAN `http://<ip>:PORT/player` addresses (`lanUrls`; Docker/VM bridges last). `hostUrls`: `https://<ip>:HTTPS_PORT/host` for a laptop host (empty when HTTPS is off). Used by the Party tab link/QR codes and the TV join QR (`web/src/lib/join.ts`) |
| POST | `/api/players/:id/roll` | `{notation, label}` | Phone roll for a virtual-dice player. Runs `roll_dice` for their character (the TV animates it) and notes it to a running DM. Returns the roll summary plus `dmInformed` to the host; any other caller gets only `{ok, total, dmInformed}` (`seatRollReply`: no target AC or DM hints) |
| POST | `/api/players/:id/physical-roll` | `{total, natural?}` | Only accepted when `pendingRoll` is this player's character. The total must be an integer from -20 to 200; `natural` must be 1 or 20. Callers below the host get `{ok, total}` or `{ok: false, error}` |
| GET | `/api/players/:id/notes` | | `{text, updatedAt}` (empty text and 0 when never saved): that player's private notes for the current campaign |
| PUT | `/api/players/:id/notes` | `{text}` | Saves the notes (string, max 20 000 characters) → `{updatedAt}`. Stored in SQLite `player_notes`, never in the game state or DM context |
| GET | `/api/players/:id/spells` | | `{spells: SpellChipInfo[]}`: read-only cards for that player's own `spells`, in sheet order: `{name, known, srdName?, level, school, concentration, ritual, castingTime, range, duration, summary, atLevels?}` from the SRD `SpellCatalog` (`atLevels`: `SpellLevelRow[]` from `engine/rules/cast.ts` `spellLevelRows`) (`find`: aliases and unique fuzzy matches). Unknown spells are `{name, known: false}`. Built by `spellSummaries` in `game/player.ts` |
| POST | `/api/players/:id/dice-mode` | `{diceMode}` | The only character field a phone can change |
| POST | `/api/players/:id/mic` | `{muted}` | Table access. `{muted}`; table mic mute from a phone (the log names the player) |
| GET/POST | `/api/players/:id/roster`, `/api/players/:id/roster/:rosterId/join` | | Phone "Saved" tab: the roster with `mine`, `levelMismatch`, `inCampaign`; join as this seat (`playerJoinFromRoster`) |
| GET/PATCH/DELETE | `/api/players/:id/creation` (+ `/options`, `/roll-scores`, `/portrait`, `/join`, `/submit`, `/withdraw`, `/chat`) | see [phone creation](../gameplay/phone-creation.md) | The seat's private character draft; every call returns a `CreationView`. `/chat` is 409 while a reply is in flight |
| GET/POST | `/api/creation/pending`, `/api/creation/:playerId/approve`, `/api/creation/:playerId/return` | `{message}` | Host-only: drafts sent for approval |
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
| POST | `/api/dm/voice` | SDP offer (`application/sdp`) | Table access. SDP answer; starts the voice DM. Posted by `/table` (`VoiceLink`). `?resume=1` (browser rebuilt a dropped call): the DM continues instead of greeting. `?handover=1` (after a `voice_handover` prepare): builds a standby call next to the live one; see [voice handover](voice-handover.md) |
| POST | `/api/dm/text` | | Starts the text-only DM |
| POST | `/api/dm/stop` | | Stops the DM and sends `voice_command stop` to the table, which hangs up its call |
| POST | `/api/dm/stop-talking` | | `{stopped}`; cuts the DM off mid-sentence (cancel response, clear WebRTC audio, drop the queued reply). 400 if the DM isn't running |
| POST | `/api/floor/release` | — | Host only (`auth/access.ts`). Frees the push-to-talk floor from whoever holds it (a stuck or hogged button) and broadcasts `{type:"floor"}`; returns the `FloorView`. See [push-to-talk](realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts) |
| POST | `/api/push-to-talk` | `{on}` | Host only. `{pushToTalk}`; push-to-talk on (hold to talk to the DM) or off (open mic). Broadcasts `{type:"floor"}`; see [push-to-talk](realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts) |
| POST | `/api/mic` | `{muted, source?}` | Table access. `{muted}`; table mic hard mute (host button/hotkey, TV key). Broadcasts `{type:"mic"}`; see [realtime audio and turns](realtime-audio-and-turns.md#table-mic-mute-setmicmuted) |
| POST | `/api/npc/clip-ended` | `{url}` | Table access. `{ok}`; `/table` reports that the playing `speak_as_npc` clip ended or failed (a muted table never reports; the server times out instead). Frees the NPC clip queue so the DM continues; `ok:false` if that clip isn't the one playing (e.g. a second table) |
| POST | `/api/dm/say` | `{text, playerId?}` | Typed player message, trimmed (blank is 400); a player's text is capped at `SAY_MAX` (500), the host's is not. Player access, but a player's `playerId` must be its own seat (403); a seat-bound caller gets 429 within `SAY_MIN_GAP_MS` (2 s) of its last message that reached the DM and 409 while someone else holds the push-to-talk floor |
| GET | `/api/rtc/config` | | Player access. `{iceServers}` from `ICE_SERVERS` (public STUN by default) for the [online call](../web/online-call.md) (`call/useCall.ts`) |
| POST | `/api/dm/whisper` | `{text}` | Private host instruction to the DM |

## Static routes and sockets

- `GET /media/:campaignId/:file` serves generated images (`.png`) and NPC voice clips (`.mp3`,
  `audio/mpeg`), cached as immutable.
- `GET /*` serves the built web app (`apps/web/dist`), with an SPA fallback to `index.html`.
- WebSocket upgrades check `Origin` (403 for another site) and access (bare 401): `/ws` needs player
  access, `/ws/audio` table, `/ws/audio?role=host` host. See [authentication](auth.md#websockets).
- `WS /ws` is used by `/host`, `/table` and `/player` phones (`hello` role `host|table|player`; the
  `Hub` records it, clamped to the socket's access: a player is always `player` for its own seat). It carries server events (`ServerEvent` in `packages/shared/src/events.ts`): `state`,
  `campaign`, `roll`, `speaker`, `talk`, `dm_status`, `mic`, `job`, `enroll`, `error`, `npc_speech`, `npc_focus`,
  `caption`, `voice_owner`, `floor`, `voice_handover`, and `voice_command` (only to the owner table). A
  snapshot is sent on connect to a player cookie, and after the `hello` to host and table sockets.
  Player sockets (a player cookie, or a `hello` with role `player`) get the public projection and
  never `job` or `error` ([state projection](state-projection.md)). Clients send `hello`, `ping`, `ptt`
  (push-to-talk: a player cookie only for its own seat; a press within 250 ms of the socket's last one is ignored; in the room by the socket's origin, see [push-to-talk](realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts)) and, from `/table`, `voice_link`.
- `/ws` heartbeat: the server pings every socket every 10 s and terminates one that missed the
  previous pong (a dropped phone lets go of the floor and the call). `/ws/audio` has none.
- `WS /ws/audio?role=host|table` (default `table`) is inbound only: binary PCM16 mono at 16 kHz,
  used for voice ID. The `/table` mic feeds it during play, the `/host` mic while a voice is
  enrolled (`pickAudioSource`); chunks from the other source are dropped. Frames are dropped while
  the table mic is muted.

Media URL rules (bugs/static-assets-route-collision, bugs/roster-portrait-stale-cache,
bugs/repaint-keeps-board-edits):
- **Generated files live under `/media`, never `/assets`.** Vite's build output owns `/assets`
  (`/assets/index-*.js`). The prefix is `ASSET_URL_PREFIX`.
- **`/media` responses are `immutable` for a year**, so a URL must never point at changed bytes.
  - Most file names are content hashes (`imageFileName`, `npc_<hash>.mp3`).
  - A forced repaint adds a nonce to the image hash.
  - A file overwritten in place gets a `?v=<sha1 prefix>` query, as `game/roster.ts` does for
    roster portraits.
- **The web app is served with `@fastify/static` `wildcard: true`.** With `wildcard: false` it
  registers one route per file present at startup, so a fresh build's hashed bundles fell through
  to the SPA fallback.
- The roster's files are `<DATA_DIR>/roster/assets/` (served as `/media/roster/<rosterId>.png`), so
  `roster` is a reserved campaign id ([persistence](persistence.md)).
