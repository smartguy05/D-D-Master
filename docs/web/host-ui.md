---
title: Host control screen (/host)
area: web
topic: host-ui
related_code:
  - apps/web/src/host/PhoneCreation.tsx
  - apps/web/src/host/partyGroups.ts
  - apps/web/src/host/PartySpotlight.tsx
  - apps/web/src/host/**
  - apps/web/src/lib/**
  - apps/web/src/main.tsx
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: BuilderPanel: DM-offline notice"
  - "2026-10-22: Unassign a character from a player (characterId: null)"
  - "2026-10-22: End-session prompt banner when the campaign is completed/failed (host/sessionPrompt.ts)"
  - "2026-10-22: Phone creation card; personality fields in the editor"
  - "2026-10-22: Host Talk button: RoomTalk built on TalkPress (shared retry); last-10 s countdown and expired state"
  - "2026-10-22: Online card: Sign out other host devices button"
  - "2026-10-22: Host Talk button: RoomTalk re-sends a refused press when the floor comes free; release wiring in testable RoomTalk.attach / roomTalkPointer"
  - "2026-10-22: Play tab hold-to-talk Talk button for the room (host/hostTalkButton.tsx, host/hostTalk.ts) while push-to-talk is on"
  - "2026-10-22: Phase 5: VoiceLink onRemoteStream/replaceStream; useServer onPeers/onRtc"
  - "2026-10-22: /play/:playerId route (main.tsx, remote-play.md); useServer playClips option: a remote /play page plays NPC clips without reporting their end; lib/auth.ts seatPage"
  - "2026-10-22: Free the floor button next to the push-to-talk holder pill (POST /api/floor/release)"
  - "2026-10-22: Push-to-talk toggle (POST /api/push-to-talk) and floor holder pill in the Play tab"
  - "2026-10-22: Online card and auth review fixes: ONLINE_URL for the invite link, seat takeover, rate limits per /64 plus a global budget"
  - "2026-10-22: Party tab Online card (table code, Rotate, invite link, seats with Kick); /login and /join routes; api.ts and useServer go to sign in on 401 / refused socket (lib/auth.ts)"
  - "2026-10-21: /host is controls only: no VoiceLink; MicControl is the enrollment mic (MicStreamer('host')); Start/Reconnect via /api/dm/voice/start|reconnect; voice_owner pills and closed-table notice; useServer voiceOwner/onVoiceCommand/sendToServer (bugs/closing-host-kills-dm)"
  - "2026-10-21: MicStreamer reconnects /ws/audio (backoff) and the Voice ID offline pill; VoiceLink planned handover (voice_handover events); NpcClipPlayer onBlocked; lib/audioUnlock.ts"
  - "2026-10-20: AI players: Add AI player, AI checkbox + persona (Party); status, Pause, Nudge (Play)"
  - "2026-10-20: Party & spotlight card (Adventure tab; Play tab while split); Regroup here; Board in-focus pill"
  - "2026-10-20: Adventure tab death rule select (create form and current campaign)"
  - "2026-10-20: Roster panel also refetches when the campaign ends (rosterRefreshKey)"
  - "2026-10-20: Party tab roster: Save/Update roster, Save all, Bring an existing hero (RosterPanel, host/roster.ts), end-of-campaign prompt"
  - "2026-10-20: Monsters panel attitude badge and -/+ buttons (adjust_attitude, lib/attitudeBadge.ts); monsterColor by attitude"
  - "2026-10-20: Board tab Objects mode (place/hide/use/remove map objects, board/objects.ts), feature interactive checkbox; useServer onPickup"
  - "2026-10-20: Play tab end_combat outcome picker and End campaign button; useServer onMoment"
  - "2026-10-20: Walls: door drawn over a wall cuts it, hitSegment prefers doors on ties, edited-by-host label only for host edits"
  - "2026-10-20: Board tab walls mode (edit_walls add/delete/toggle/reset), wall overlay in every mode, geometry wall helpers"
  - "2026-10-20: Board monster colours; Play tab critical checkbox"
  - "2026-10-20: Fixed-width Undo; right-anchored feature labels"
  - "2026-10-20: Fixed-width Undo; right-anchored feature labels"
  - "2026-10-20: Party tab kept mounted; job chip elapsed time"
  - "2026-10-20: Monsters panel disposition button"
  - "2026-10-19: Campaign reset button and ResetPanel"
  - "2026-10-19: Adventure tab location cards show a fog badge"
  - "2026-10-19: Outline editor: per-location Fog checkbox"
  - "2026-10-19: Table mic mute button, P hotkey, lib/mic.ts"
  - "2026-10-19: Per-player join QR codes (PlayerLinks)"
  - "2026-10-18: Paint map button disabled while that map paints"
  - "2026-10-18: api.ts names an unreachable server instead of 'Failed to fetch'"
  - "2026-10-18: Review round 1: editor dirty tracking (editFields.ts, changed-on-server hint, Save sends dirty fields only); level-up shows the engine note"
  - "2026-10-18: Party tab rules controls (RulesPanel.tsx): Short/Long rest, level up with subclass picker, slot/Pact/resource adjusters, Stabilize/Revive/End concentration, rules line; editor follows server values"
  - "2026-09-24: Added outline editor, export/import buttons and undo/history controls"
  - "2026-09-24: Voice link state, Reconnect button, npc_speech playback"
  - "2026-09-24: Initial version"
  - "2026-09-24: Party tab: player phone link, Build by voice, BuilderPanel"
  - "2026-10-18: Stop talking button"
  - "2026-10-18: Board tab (2D grid editor: tokens, fog reveal/hide, map features, monster hide/remove)"
  - "2026-10-18: Board: expect_name, number fields, repaint resets edits"
  - "2026-10-18: useServer onRoll gets the latest state"
  - "2026-10-18: Lost-call banner (lostCall.ts)"
  - "2026-10-18: NpcClipPlayer for npc_speech on /table"
  - "2026-10-18: Muted table does not report NPC clips"
  - "2026-10-18: Play tab: Add NPC row (add_npc, outline NPC suggestions, follows toggle)"
---

# Host control screen (`/host`)

This page holds the controls. `HostPage.tsx` holds four tabs, the status pills, and the
enrollment microphone. The voice call itself (table mic, the DM's audio, WebRTC) runs on
[`/table`](table-display.md#voice-call-usetablevoicets), so this tab can be closed or reloaded
mid-game without taking the DM offline ([voice ownership](../server/voice-ownership.md)). Open
both on the same laptop (`localhost` allows the mic).

## Enrollment microphone (`MicControl`)

`mic.enable()` (Party tab, **Enable microphone for voice enrollment**) calls `getUserMedia` once,
with echo cancellation, noise suppression and AGC, and starts `MicStreamer("host")`
(`/ws/audio?role=host`). The server only uses this stream while a voice is being recorded
(`pickAudioSource`); during play voice ID hears the table's stream. Browsers only allow microphone
access on `localhost` or HTTPS, so open `/host` on the machine running the server, or use the
HTTPS port.

The header shows pills for the server connection, the OpenAI key, the brain, voice ID and DM status,
plus a live mic level meter (🔇 and empty while the table mic is muted). Call-related pills:
- **Enrollment mic offline — reconnecting** (red): the enrollment mic is on but its `/ws/audio`
  socket is down; `MicStreamer` reopens it by itself.
- **Voice ID offline** (red): a voice DM is live but `voice_owner.micStream` is false (no table
  mic stream reaches voice ID).
- The table link pill reads **open table screen ↗**, or red **table screen closed: open it ↗**
  when `voice_owner.table` is false.

`HostPage` stops the streamer when the page unmounts.

**Table mic mute.** The server holds the flag (`view.micMuted` from the `mic` event). `/table`
applies it to the call's mic and `HostPage` to the enrollment mic, with `lib/mic.ts` `applyMicMute`
(`track.enabled = false`, no renegotiation), also when the mic is first enabled. **P** toggles it
anywhere on `/host` except while typing (`isMicHotkey`).

## Tabs

**📜 Adventure** (`AdventureTab.tsx`)
- Campaign list: load, **⇩ export** (downloads `.dmc.json.gz`), **↺ reset** or delete, and create
  one (name, party level, *Campaign fails when*: the whole party is dead / any character dies, sent
  as `deathRule`). Below the list, the current campaign's *Campaign fails when* select changes its
  death rule (`PATCH /api/campaign/settings`). Reset opens `ResetPanel` (`CampaignFiles.tsx`) under the row with three
  checkboxes (keep outline & maps, players & voiceprints, characters), an export link and a final
  confirm; it calls `POST /api/campaigns/:id/reset`. **⇧ Import campaign file** uploads an export as a new campaign (`CampaignFiles.tsx`).
- Story: enter a premise and length, then *Write adventure* (brain). The outline shows the title,
  hook and acts.
- **✎ Edit outline** (or *Write outline by hand* when there is none) opens `OutlineEditor.tsx`. It
  edits a local draft of the title, hook, acts, locations (name, description, map prompt, grid W×H),
  NPCs (including each NPC's voice direction) and encounters. Encounter monsters use a `<datalist>` autocomplete from `GET /api/monsters`
  and are flagged "not in SRD" when they don't match. Removing a location also removes its
  encounters. Each location has a **Fog** checkbox (`Location.fog`, on by default): fog of war turns
  on when the party first arrives; untick it for shops, inns and other lit places. *Save outline* sends `PUT /api/campaign/outline`. A changed map prompt clears that
  map, and *Paint map* redraws it.
- Locations: map thumbnails, a fog badge (`host/fogStatus.ts`: the live entry's *Fog on/off* once
  visited, otherwise the outline flag as *Fog on arrival* / *No fog*), *Go here* (`change_scene`), *Paint/Repaint map* (disabled, "Painting…",
  while that map paints, from the button or from a running `Painting map:` job), and per-encounter
  *Spawn* buttons.
- NPC list. *End session & write recap* and the list of past recaps.
- **End-session prompt** (`HostPage.tsx`, `host/sessionPrompt.ts`): once the campaign is completed
  or failed, a banner above every tab offers *End session & write recap* (`POST
  /api/campaign/end-session`) or *Not yet* (hidden for that campaign). It shows while the DM is
  still live, or while no recap has been written since `completedAt`, so a finished campaign's DM
  doesn't run on forever.
- **Party & spotlight** (`PartySpotlight.tsx`, `partyGroups.ts`; above Locations, and on the Play
  tab while the party is split): one row per group (★ on the TV, ⚔ round/turn badge, "(frozen)"
  off screen) with **Focus** (`focus_scene`), and a location dropdown per PC (`change_scene` with
  `character_ids: [id]`) to split or regroup. While split, a location's *Go here* reads *Regroup
  here*, and the Board tab shows "in focus · party split" (it edits the scene in focus only). See
  [party split](../gameplay/party-split.md).

**🛡 Party** (`PartyTab.tsx`, `CharacterEditor.tsx`): kept mounted (hidden) while another tab is
open, so pregens being generated, a pasted sheet and a half-filled form survive a tab switch.
Loading another campaign clears them, and pregens that arrive for the previous campaign are dropped.
- Players: add a player, assign a character (**— no character —** unassigns it: the PATCH sends
  `characterId: null`, and the old character's `playerName` is cleared), and **Record voice** / **Done**. Enrollment happens
  once; re-recording adds a sample. **🤖 Add AI player** / the **🤖 AI** checkbox makes a seat an
  [AI player](../gameplay/ai-players.md); its row shows a persona box instead of enrollment.
- A hint with the phone address and, under **Show join QR codes**, one QR code per player that
  opens their own sheet (`<base>/player/<id>`) (`PlayerLinks.tsx`; base from `lib/join.ts`:
  `PUBLIC_URL`, else the LAN IP from `GET /api/player-urls` when the host is on localhost). See the
  [player view](player-view.md).
- **Online** card (`OnlineCard.tsx`, helpers in `online.ts`; refreshes every 5 s from
  `GET /api/auth/sessions`): the table code with **↻ Rotate** (hidden when `TABLE_CODE` is set),
  **⧉ Copy invite link** (`ONLINE_URL/join?code=…`, else the join base), an `ONLINE_URL` reminder,
  whether host sign-in and the LAN bypass are on, **Sign out other host devices** (with host sign-in on;
  `POST /api/auth/hosts/revoke`), and each human seat (free / joined, offline /
  online) with **Kick**. See [online play](../setup/online-play.md).
- **🗣 Build by voice** per player starts the voice character builder. While it runs, an editable
  **BuilderPanel** (`BuilderPanel.tsx`) at the top of the tab shows the live draft, with **Save
  edits**, **Finalize character** and **Cancel**. While the DM is offline the panel says the
  interview starts when the DM does. See [characters](../gameplay/characters.md).
- Characters: a list with sprite, HP, AC and dice mode, plus a cyan **rules line** (`rulesLine` in
  `player/sheet.ts`, e.g. `slots 1:2/4 2:2/2 · HD 3/3 d6 · conc Bless · DOWN S1 F2 · Rage 2/3`,
  left/max everywhere) and quick buttons when they apply (`characterActions`): **✚ Stabilize**
  (0 HP, dying), **✨ Revive** (Dead; 1 HP after a revival spell), **◎ End <spell>**.
- **Rests** (`RestControls` in `RulesPanel.tsx`, above the list):
  - **☾ Short rest…** opens a panel with one row per character: Hit Point Dice to spend (0 to the
    dice left, `shortRestRows`); characters at 0 HP show "at 0 HP" and are left out. *Finish short
    rest* calls `short_rest` once with `shortRestArgs` (resting PCs, dice clamped, zeros dropped).
  - **☀ Long rest** asks for confirmation and calls `long_rest {}` (the whole party).
  - A one-line summary of the result (`restSummary`) shows beside the buttons.
  - **Decision:** Hit Dice are spent here, not on the phones. There is no "short rest in progress"
    state, and one `short_rest` call per die would also reset Pact slots and short-rest features
    every time.
- *Edit* opens `CharacterEditor`, the host override panel: HP, max, AC, gold, dice mode, conditions
  and items as clickable chips, appearance plus *Redraw sprite*, and delete. HP, max, AC, gold and
  appearance use dirty tracking (`editFields.ts`): a field the host has not typed into follows
  server changes (rests, damage, level-up); a typed, unsaved field keeps its value, gets a gold
  border, and shows "changed on server: N" when the server value moves. *Save* (enabled only when
  something is dirty) PATCHes only the dirty fields, so it never writes back stale values. Its
  **Rules** section (`RulesEditor`):
  - **⬆ Level up** with *Average HP* / *Roll HP* calls `level_up`. When the result is
    `{error, subclass_options}` (the subclass level), a picker appears with the SRD option and
    *Other…* (free text), and *Level up as …* retries with `subclass` (`levelUpOutcome`). The
    result line lists the new features and the engine's `note` (a non-SRD class or subclass: add
    its features by hand).
  - Spell slot rows (and Pact Magic) with pips (filled = available): **−** spends one, **+** gives
    one back, via `PATCH /api/characters/:id {spellSlots | pactSlots}` (`adjustSlots`/`adjustPact`
    clamp `used` to 0..max). This is a logged, undoable host edit.
  - Resource rows (Rage, Second Wind, Arcane Recovery…): **−**/**+** call `use_resource` with
    `amount` 1 / -1. The reset rule is shown (`Short Rest`, `Long Rest (1 back on a Short Rest)`).
  - Tool calls go through `POST /api/tools/:name`; a returned `{error}` is shown like an HTTP error
    (`toolError`).
- Add a character in one of four ways:
  - *Build one*: a form with abilities, attacks and inventory as text lines.
  - *Import a sheet*: paste the sheet; the brain parses it.
  - *AI pregens*: set a count and wishes, then *Take for…* a player.
  - *Bring an existing hero*: the **Roster panel** (`RosterPanel.tsx`) lists `GET /api/roster`
    with portrait (or initial), name, `rosterLabel` (`Fighter (Champion) · Lv 5`), player, voice
    badge and "updated … ago" (`updatedAgo`). **Join campaign** (optional player select: players
    with no live character) posts `/api/roster/:id/join`; it is disabled with the reason when the
    hero is already in the campaign (`joinBlocked`). **Delete** confirms first. Helpers are in
    `host/roster.ts`. See [character roster](../gameplay/character-roster.md).
- Roster saving: each character row has **Save to roster** (**Update roster** plus a *linked*
  badge once it has a `rosterId`), and the Characters header has **💾 Save all to roster**
  (`POST /api/roster/save/:id`, `/api/roster/save-all`). `HostPage` holds a roster version counter
  that every save/join/delete bumps, so the Roster panel refetches. It is also bumped when
  `rosterRefreshKey(campaign)` changes (the campaign becomes completed or failed), because
  `end_campaign` saves linked PCs back to the roster on the server without a roster event.
- **End-of-campaign prompt** (`HostPage`): once `campaign.status` is `completed` or `failed`, a
  banner above the tabs lists the unlinked characters (`rosterPrompt`) with **💾 Save all to
  roster** and *Dismiss* (per campaign). It disappears when none are left unlinked.

**🎲 Play** (`PlayTab.tsx`)
- Start the voice DM (`POST /api/dm/voice/start`: the server tells `/table` to start the call; the
  mic prompt appears in the table tab the first time) or the text-only DM, and stop it
  (`/api/dm/stop` also hangs up the table's call). With no table screen open, **Start voice** is
  disabled and a notice offers **Open the table screen ↗**; the text DM still works. **✋ Stop talking** (enabled while the DM is
  `speaking` or `thinking`) cuts it off mid-sentence via `/api/dm/stop-talking`; talking over the
  DM no longer interrupts it.
- **🔇 Mute table mic** / **🎙 Unmute (DM not listening)** (red and pulsing while muted) toggles
  the hard mute via `/api/mic`. A sentence the DM is saying still finishes; unmuting doesn't make
  it speak. Shown whenever a campaign is loaded. Voice enrollment (Party tab) is disabled while muted.
- **✋ Push-to-talk: on** / **🎙 Open mic** toggles push-to-talk for this run via
  `POST /api/push-to-talk` (default `PUSH_TO_TALK`; a restart goes back to it). On, the DM hears a
  voice turn only while someone holds Space on the TV, the host's Talk button or the talk button on a
  phone; off, the table is an open mic as before.
- **🎙 Hold to talk (room)** (`host/hostTalkButton.tsx`, logic in `host/hostTalk.ts`), shown while
  push-to-talk is on: hold it to talk to the DM for the whole table, like Space on the TV (a TV with
  no keyboard and no phones would otherwise drop every voice turn). It sends `ptt` over /ws with no
  `playerId`, which the server takes as a room press from this socket (only this socket can release
  it). Gold while the room holds the floor (this press or the TV's Space), dashed with the holder's
  name while a player holds it, gold-outlined while pressed but not yet granted. The server drops a
  press while someone else holds the floor or inside its 250 ms press-after-press throttle (it doesn't
  queue it), so `RoomTalk` (a `lib/floor.ts` `TalkPress` for the room, the same retry the TV's Space
  and the phones use) sends the down again while the button is held and the room hasn't had the
  floor: when the floor comes free, and every `ROOM_TALK_RETRY_MS` while it is free. Once the room
  has held it (this press or the TV's Space) it never re-takes it on its own (the 30 s cap stands):
  in the last 10 s the label counts down ("(7 s left)", `useHoldCountdown`), and held past the cap it
  turns red-dashed: "Time's up: let go and press again" (`expired`). It lets go
  on pointerup/cancel/leave and lost pointer capture (`roomTalkPointer`), the page hiding and
  unmount (`RoomTalk.attach`), and push-to-talk turning off mid-press (`RoomTalk.update`). A green pill names who holds the floor (`lib/floor.ts` `floorLabel`),
  with a small **Free the floor** button (`POST /api/floor/release`) to take it back from a stuck or
  hogged button.
  See [push-to-talk](../server/realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts).
- While voice is on, a **voice link** pill shows the table's WebRTC state from `view.voiceOwner`
  (`connecting`, `connected`, `reconnecting…`, `failed`) with a **↻ Reconnect** button
  (`POST /api/dm/voice/reconnect`). The DM status pill reads
  "reconnecting…" while the server re-attaches a dropped sideband.
- **Lost-call banner**: if the table's WebRTC call is still `connected` but the server DM has been
  `offline` for 3 s (`lostCall.ts`; usually a server restart whose automatic re-attach failed), a
  red notice explains that no tools run and offers **↻ Reconnect voice DM**, which builds a new
  call and resumes.
- **Who's speaking?** buttons override voice ID for the next turn and show "(no voice)" for players
  who haven't enrolled.
- A physical roll prompt appears when the DM waits on real dice; enter the total there. For a
  damage roll a **💥 Critical** checkbox (preset from `pendingRoll.critical`) is sent with it.
- **AI players** (when any): status from the `ai_player` event (idle/thinking/speaking + last line),
  **⏸ Pause / ▶ Resume** (`PATCH aiPaused`) and **👉 Nudge** (`POST /api/players/:id/ai/nudge`).
- Type to the DM as a player, or whisper instructions the players won't hear.
- Table log: DM speech, player transcripts with speaker labels, rolls and system lines.
- Manual controls:
  - **↶ Undo: <label>** (fixed width, the label ellipsised; the full label is the tooltip) and a
    fixed-width **History** dropdown (`HistoryControls.tsx`). The dropdown lists the
    last 50 changes and refetches `GET /api/history` whenever `state.version` changes. Picking an
    entry asks for confirmation, then rewinds to before it.
  - Roll any notation, with quick dice buttons.
  - Damage, heal or remove a target.
  - Start combat, next turn, end combat. A picker beside **End combat** sends `end_combat` with
    `outcome` Victory / Fled / Defeat, or nothing for **auto** (the server decides from HP).
  - **🏁 End campaign**: pick success or failure, type an optional epilogue, confirm, and it posts
    `/api/tools/end_campaign {outcome, epilogue?}` (the TV shows the campaign-complete screen).
    When `campaign.status` isn't `active` the button is disabled and reads "Campaign completed" or
    "Campaign failed"; resetting the campaign reopens it.
  - **Add NPC**: a name (outline NPCs are suggested) and *follows party* → `add_npc`. The token stands
    next to the party with its own portrait.
  - Rules search.

**🗺 Board** (`board/BoardTab.tsx`, `board/geometry.ts`)
- A 2D grid over the current location's painted map (`mapUrl`, stretched over `gridW × gridH`
  exactly like the TV board). SVG with one unit per cell. It draws the grid, fog cells (dark while
  fog is on, faint while off; host-hidden cells red), map features coloured by kind (entrance
  green, exit cyan, focal gold, feature purple; 💡 lit, ⛔ blocks) and tokens (hidden monsters
  faded with a dashed ring). Features are `effectiveFeatures(state, loc)`, so host fixes show.
  In every mode it also overlays the walls in effect (`effectiveWalls(state, loc)`): walls white,
  doors orange (thick when closed, dashed when open), windows light blue. The TV shows only doors.
- Modes (pointer events with pointer capture; **each drop is exactly one tool call**, so each edit
  is one undo step with a `host:` label):
  - **✋ Move**: drag a token → `move_token`. Monster tokens use the TV's colours
    (`lib/tokenColor.ts` `monsterColor`, by attitude from `attitudeOf`: hostile red, friendly
    green, indifferent amber; `attitudeColor` maps an attitude to its colour). Old saves without
    attitude fields derive it from the disposition flags, so their colours are unchanged.
  - **☀ Reveal / ☁ Hide**: drag a rectangle → `edit_fog {mode, cells}`. Hidden cells stay dark even
    when party light reaches them, until revealed again.
  - **▣ Features**: click to select, drag to move, drag a corner handle to resize →
    `edit_map_feature update`. The side panel edits name, kind, lit, blocks, **interactive** (players can use or
    open it; the label gets ✦ and the TV an aura) and x/y/w/h, and has
    **＋ Add feature**, **Delete** and **↺ Use map read** (`reset`: drop host edits). Every
    update/delete sends `expect_name`, so a feature list that changed meanwhile (DM, undo) is
    refused instead of editing the wrong feature. The x/y/w/h fields are raw text while typing;
    *Save* reads them with `boxFromInputs` (an empty field keeps the old value, never 0).
  - **▮ Walls**: pick *Wall / Door / Window* in the side panel, then click two grid crossings
    (`clientToIntersection`) in one row or column → `edit_walls add` (`segmentBetween`; a diagonal
    second click is ignored and the anchor stays; *Cancel* drops it). A preview line follows the
    pointer. Clicking a segment (`hitSegment`, 0.2 cells; a click right on a crossing starts a new
    segment instead) selects it: **Delete** (`edit_walls delete`) or, for doors,
    **Open/Close door** (`edit_walls toggle`). The panel lists the doors with a toggle each, and
    **↺ Use map read** (`edit_walls reset`) drops the host's wall edits and door states. Every
    edit re-runs the fog reveal on the server.
  - **👹 Monsters**: click a token or the list → **Hide/Show** (`set_monster_hidden`), the
    disposition button (👹 Foe → 🤝 Ally → 😐 Neutral, `set_disposition`, `host/disposition.ts`;
    the DM gets a host note) or **Remove** (`remove_monster`). "· out of combat" marks a
    non-combatant NPC. Each row also has an **attitude badge** (`lib/attitudeBadge.ts`
    `attitudeBadge`, e.g. "🙂 Friendly +3", coloured by `attitudeColor`) between **−** and **＋**
    buttons that call `adjust_attitude` with `delta` -1 / +1 and a host reason (disabled at -5 /
    +5). Crossing a threshold (≤ -3 Hostile, ≥ +3 Friendly) flips the disposition too, so the
    badge, ring colour and lists update with the next state. See
    [NPC attitude](../gameplay/running-a-session.md).
  - **✦ Objects**: the map objects of the current location (`state.mapObjects`): loot 💰 and
    interactables ✦ on the board (hidden ones faded with a dashed edge, used ones dim; tooltip
    `objectSummary` from `board/objects.ts`) and in the side list (name, kind, cell, contents via
    `objectContents`, hidden/used). **✦ Place interactable**, then click a cell, asks for a name and
    calls `place_interactable` (the DM gets a host note). Each row has **Hide/Show**
    (`set_interactable hidden`), **Mark used/Unuse** for interactables (`set_interactable used`) and
    **Remove** (`remove_map_object`).
  - Feature labels stay on the board (`featureLabelPlacement` in `board/geometry.ts`): from the
    feature's left edge when they fit, else ending at its right edge, else pushed in from the edge.
- Fog **on/off** (`set_fog enable|disable`) and **reset** (clears explored and hidden cells), plus
  the same Undo/History controls as the Play tab.
- Host feature fixes and fog painting last until the map is repainted: *Repaint map* always paints
  a new picture and drops them in one undoable step (`map repainted: …`). Host wall edits
  (`state.wallEdits`, `host: true`) survive a repaint of the same location until the host resets
  them; door states the DM set alone are dropped, and only host edits show "edited by host". A door
  or window drawn on a wall replaces that stretch of wall, and `hitSegment` prefers a door or
  window over a wall at the same distance.
- `geometry.ts` is pure (pixel→cell incl. a zero-size board, drag rectangles, move/resize that pull
  off-grid boxes back in, corner hit-testing, `boxFromInputs`; for walls `clientToIntersection`,
  `segmentBetween`, `hitSegment`)
  and tested in `geometry.test.ts`.

## Client libraries (`src/lib`)

- `api.ts`: a `fetch` wrapper that throws the server's `error` message. When `fetch` itself rejects
  ("Failed to fetch": no server), it throws "Can't reach the game server. Is it running?" instead.
  A `401` from a non-sign-in route also sends the page to `/login` or `/join` (`auth.ts`
  `redirectIfUnauthorized`; the raw fetches in `voice.ts` and `CampaignFiles.tsx` do the same).
- `auth.ts`: sign-in helpers: `signInPath`, `safeNext`, `redirectToSignIn`, and for `useServer`
  `needsCheck` / `afterSocketClose`. A `/ws` that never opened or closed with `4401` asks
  `GET /api/auth/me`; if that access can't use the page's role, the page goes to sign in instead of
  retrying forever. See [authentication](../server/auth.md#web-side).
- `useServer.ts`: reconnecting `/ws` hook (role `host`, `table` or `player`) that returns `{connected, campaign, state, dm, speaker,
  jobs, errors, lastEnroll, voiceOwner}` (`voiceOwner` is null until the snapshot and after a drop).
  `onVoiceCommand` / `onVoiceHandover` listeners get `voice_command` / `voice_handover`;
  `sendToServer(ev)` sends a `ClientEvent` (the table's `voice_link`) on the open socket. Job chips (`JobChip` in `HostPage.tsx`) show `⏳ label · m:ss` (elapsed since the
  job's server `startedAt`, `lib/elapsed.ts`) while running; each chip ticks itself. Roll events go to an `onRoll(roll, latestState)` callback, so the
  table can queue animations; `latestState` is the newest `state` event (a ref set before
  `setView`), never a stale render. Effect events go to `onEffect(effect)` and moment events to
  `onMoment(moment, latestState)` (4th parameter, through a ref), and pick-up events to
  `onPickup(pickup)` (5th parameter). Moments and pick-ups are never stored in `ServerView`.
- `voice.ts`: `getTableMic`, `MicStreamer(role)` (inline AudioWorklet, 16 kHz PCM16 over
  `audioSocketUrl(role)` = `/ws/audio?role=host|table`; `resume()` wakes an AudioContext created
  before a gesture), and `VoiceLink` (RTCPeerConnection plus an `<audio>` sink; POSTs the SDP to `/api/dm/voice`).
  `VoiceLink` rebuilds the call by itself when the peer fails or stays disconnected for 5 s, and
  exposes its state through `subscribe()` (tested in `voice.test.ts` with a fake peer). `active`
  says a call exists; `resume(stream)` joins a running DM after a reload (`?resume=1`, state
  `reconnecting`). `playRemote` calls `play()`; a refusal calls the `onRemoteAudioBlocked` callback
  and `retryRemoteAudio()` plays it again after an unlock. `onRemoteStream(fn)` / `remoteStream` give
  the DM's audio stream (forwarded to remote players), and `replaceStream(stream)` swaps the track the
  DM hears without renegotiating (the TV's DM mix, [online call](online-call.md)).
- `useServer.ts` also routes the online call's `peers` and `rtc` events to `onPeers` / `onRtc`
  (a closed socket reads as "not in the call").
  - `MicStreamer` reconnects: when `/ws/audio` closes it reopens after 1, 2, 4, then every 5 s
    (`MIC_RECONNECT_DELAYS_MS`; an open resets it) until `stop()`. `connected` plus `onChange`
    drive the voice-ID pill; chunks recorded while the socket is down are dropped. `createSocket`
    is injectable for tests.
  - `postOffer(sdp, mode)`: `mode` is `start`, `resume` (`?resume=1`) or `handover`
    (`?handover=1`).
  - **Planned handover** (the server renews the call before Realtime's 60-minute cap). `useServer`
    passes `voice_handover` events to `onVoiceHandover` listeners and `/table`
    (`useTableVoice`) drives the link:
    - `prepare` → `prepareHandover()`: a second peer, the mic track added and its sender
      immediately `replaceTrack(null)` (the new call hears nothing), its remote stream held but not
      played, offer POSTed with `handover`. Only from a `connected` call.
    - `swap` → `commitHandover()` (waits for a standby still being answered): `replaceTrack(mic)`,
      `playRemote(new stream)`, close the old peer, and make the standby the current peer so the
      grace/reconnect handlers watch it. Logs "voice line renewed" to the console. If there is no
      ready standby while the link is connected, `useTableVoice` falls back to `reconnect()` (resume).
    - `abort` → `abortHandover()`: close the standby; the live call stays.
    - A reconnect, a new call or `stop()` during a pending handover drops the standby. The link
      state, the orb and the DM pill never change for a handover.
- `useServer("table")` plays `npc_speech` clips through `npcAudio.ts` `NpcClipPlayer`: one at a
  time in order; every end, error or blocked autoplay is reported with `POST /api/npc/clip-ended`
  so the DM continues. A muted table (also muted mid-clip) skips clips and reports nothing; the
  server's timeout releases the DM. A `play()` refused with `NotAllowedError` also calls
  `onBlocked` (`markAudioLocked`), so the TV shows its enable-sound overlay again. With the
  `playClips` option (6th argument) a `player` page (the remote [/play](remote-play.md)) plays the
  clips too but never reports their end: that route is table level, and the room's TV reports.
- `audioUnlock.ts`: `AudioUnlock`, the page's autoplay lock. `unlock()` (from a gesture) resumes
  the WebAudio context and plays a 10 ms silent WAV through an `HTMLAudioElement`, and counts as
  unlocked when both work (a step that never settles gives up after 1.5 s; only a
  `NotAllowedError` counts against the element). `markLocked()` re-locks; `onChange` notifies.
  `dice/sound.ts` owns the instance (`unlockAudio`, `isAudioUnlocked`, `onAudioLockChange`,
  `markAudioLocked`). See [table display](table-display.md).

## Character creation on phones (Party tab)

`host/PhoneCreation.tsx`: phone creation on/off, starting level, ability methods, homebrew, the
edit lock (Lock/Unlock), and the characters waiting for approval (preview line, the player's note,
the rule errors, Approve / Send back with a message). It refetches on `creation` events and bumps
the roster version when a phone character joins. The host character editor has the personality
fields. See [phone creation](../gameplay/phone-creation.md).
