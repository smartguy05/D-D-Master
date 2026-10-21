---
title: Host control screen (/host)
area: web
topic: host-ui
related_code:
  - apps/web/src/host/partyGroups.ts
  - apps/web/src/host/PartySpotlight.tsx
  - apps/web/src/host/**
  - apps/web/src/lib/**
  - apps/web/src/main.tsx
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
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

This page runs on the laptop that has the table mic and speaker. `HostPage.tsx` holds four tabs,
the status pills, and the shared microphone.

## Shared microphone (`MicControl`)

`mic.enable()` calls `getUserMedia` once, with echo cancellation, noise suppression and AGC, and
starts `MicStreamer` (the voice-ID feed). The same `MediaStream` is passed to `VoiceLink`
(WebRTC to Realtime). Browsers only allow microphone access on `localhost` or HTTPS, so open
`/host` on the machine running the server, or put the server behind HTTPS.

The header shows pills for the server connection, the OpenAI key, the brain, voice ID and DM status,
plus a live mic level meter (🔇 and empty while the table mic is muted).

**Table mic mute.** The server holds the flag (`view.micMuted` from the `mic` event). `HostPage`
applies it to the shared stream with `lib/mic.ts` `applyMicMute` (`track.enabled = false`, which
silences both the WebRTC DM and voice ID without renegotiating), also when the mic is first
enabled. **P** toggles it anywhere on `/host` except while typing (`isMicHotkey`).

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
- **Party & spotlight** (`PartySpotlight.tsx`, `partyGroups.ts`; above Locations, and on the Play
  tab while the party is split): one row per group (★ on the TV, ⚔ round/turn badge, "(frozen)"
  off screen) with **Focus** (`focus_scene`), and a location dropdown per PC (`change_scene` with
  `character_ids: [id]`) to split or regroup. While split, a location's *Go here* reads *Regroup
  here*, and the Board tab shows "in focus · party split" (it edits the scene in focus only). See
  [party split](../gameplay/party-split.md).

**🛡 Party** (`PartyTab.tsx`, `CharacterEditor.tsx`): kept mounted (hidden) while another tab is
open, so pregens being generated, a pasted sheet and a half-filled form survive a tab switch.
Loading another campaign clears them, and pregens that arrive for the previous campaign are dropped.
- Players: add a player, assign a character, and **Record voice** / **Done**. Enrollment happens
  once; re-recording adds a sample.
- A hint with the phone address and, under **Show join QR codes**, one QR code per player that
  opens their own sheet (`<base>/player/<id>`) (`PlayerLinks.tsx`; base from `lib/join.ts`:
  `PUBLIC_URL`, else the LAN IP from `GET /api/player-urls` when the host is on localhost). See the
  [player view](player-view.md).
- **🗣 Build by voice** per player starts the voice character builder. While it runs, an editable
  **BuilderPanel** (`BuilderPanel.tsx`) at the top of the tab shows the live draft, with **Save
  edits**, **Finalize character** and **Cancel**. See [characters](../gameplay/characters.md).
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
- Start the voice DM or text-only DM, and stop it. **✋ Stop talking** (enabled while the DM is
  `speaking` or `thinking`) cuts it off mid-sentence via `/api/dm/stop-talking`; talking over the
  DM no longer interrupts it.
- **🔇 Mute table mic** / **🎙 Unmute (DM not listening)** (red and pulsing while muted) toggles
  the hard mute via `/api/mic`. A sentence the DM is saying still finishes; unmuting doesn't make
  it speak. Shown whenever a campaign is loaded. Voice enrollment (Party tab) is disabled while muted.
- While voice is on, a **voice link** pill shows the WebRTC state (`connecting`, `connected`,
  `reconnecting…`, `failed`) with a **↻ Reconnect** button. The DM status pill reads
  "reconnecting…" while the server re-attaches a dropped sideband.
- **Lost-call banner**: if the WebRTC call is still `connected` but the server DM has been
  `offline` for 3 s (`lostCall.ts`; usually a server restart whose automatic re-attach failed), a
  red notice explains that no tools run and offers **↻ Reconnect voice DM**, which builds a new
  call and resumes.
- **Who's speaking?** buttons override voice ID for the next turn and show "(no voice)" for players
  who haven't enrolled.
- A physical roll prompt appears when the DM waits on real dice; enter the total there. For a
  damage roll a **💥 Critical** checkbox (preset from `pendingRoll.critical`) is sent with it.
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
- `useServer.ts`: reconnecting `/ws` hook (role `host`, `table` or `player`) that returns `{connected, campaign, state, dm, speaker,
  jobs, errors, lastEnroll}`. Job chips (`JobChip` in `HostPage.tsx`) show `⏳ label · m:ss` (elapsed since the
  job's server `startedAt`, `lib/elapsed.ts`) while running; each chip ticks itself. Roll events go to an `onRoll(roll, latestState)` callback, so the
  table can queue animations; `latestState` is the newest `state` event (a ref set before
  `setView`), never a stale render. Effect events go to `onEffect(effect)` and moment events to
  `onMoment(moment, latestState)` (4th parameter, through a ref), and pick-up events to
  `onPickup(pickup)` (5th parameter). Moments and pick-ups are never stored in `ServerView`.
- `voice.ts`: `getTableMic`, `MicStreamer` (inline AudioWorklet, 16 kHz PCM16 over `/ws/audio`),
  and `VoiceLink` (RTCPeerConnection plus an `<audio>` sink; POSTs the SDP to `/api/dm/voice`).
  `VoiceLink` rebuilds the call by itself when the peer fails or stays disconnected for 5 s, and
  exposes its state through `subscribe()` (tested in `voice.test.ts` with a fake peer).
- `useServer("table")` plays `npc_speech` clips through `npcAudio.ts` `NpcClipPlayer`: one at a
  time in order; every end, error or blocked autoplay is reported with `POST /api/npc/clip-ended`
  so the DM continues. A muted table (also muted mid-clip) skips clips and reports nothing; the
  server's timeout releases the DM.
