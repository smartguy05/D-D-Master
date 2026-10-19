---
title: Host control screen (/host)
area: web
topic: host-ui
related_code:
  - apps/web/src/host/**
  - apps/web/src/lib/**
  - apps/web/src/main.tsx
created: 2026-09-24
last_updated: 2026-10-18
last_audited: 2026-10-18
audited_by: claude-opus-5.5
status: current
change_log:
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
plus a live mic level meter.

## Tabs

**📜 Adventure** (`AdventureTab.tsx`)
- Campaign list: load, **⇩ export** (downloads `.dmc.json.gz`) or delete, and create one (name,
  party level). **⇧ Import campaign file** uploads an export as a new campaign (`CampaignFiles.tsx`).
- Story: enter a premise and length, then *Write adventure* (brain). The outline shows the title,
  hook and acts.
- **✎ Edit outline** (or *Write outline by hand* when there is none) opens `OutlineEditor.tsx`. It
  edits a local draft of the title, hook, acts, locations (name, description, map prompt, grid W×H),
  NPCs (including each NPC's voice direction) and encounters. Encounter monsters use a `<datalist>` autocomplete from `GET /api/monsters`
  and are flagged "not in SRD" when they don't match. Removing a location also removes its
  encounters. *Save outline* sends `PUT /api/campaign/outline`. A changed map prompt clears that
  map, and *Paint map* redraws it.
- Locations: map thumbnails, *Go here* (`change_scene`), *Paint/Repaint map* (disabled, "Painting…",
  while that map paints, from the button or from a running `Painting map:` job), and per-encounter
  *Spawn* buttons.
- NPC list. *End session & write recap* and the list of past recaps.

**🛡 Party** (`PartyTab.tsx`, `CharacterEditor.tsx`)
- Players: add a player, assign a character, and **Record voice** / **Done**. Enrollment happens
  once; re-recording adds a sample.
- A hint with the phone address (`PlayerLinks.tsx`, LAN IPs from `GET /api/player-urls`). See the
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
- Add a character in one of three ways:
  - *Build one*: a form with abilities, attacks and inventory as text lines.
  - *Import a sheet*: paste the sheet; the brain parses it.
  - *AI pregens*: set a count and wishes, then *Take for…* a player.

**🎲 Play** (`PlayTab.tsx`)
- Start the voice DM or text-only DM, and stop it. **✋ Stop talking** (enabled while the DM is
  `speaking` or `thinking`) cuts it off mid-sentence via `/api/dm/stop-talking`; talking over the
  DM no longer interrupts it.
- While voice is on, a **voice link** pill shows the WebRTC state (`connecting`, `connected`,
  `reconnecting…`, `failed`) with a **↻ Reconnect** button. The DM status pill reads
  "reconnecting…" while the server re-attaches a dropped sideband.
- **Lost-call banner**: if the WebRTC call is still `connected` but the server DM has been
  `offline` for 3 s (`lostCall.ts`; usually a server restart whose automatic re-attach failed), a
  red notice explains that no tools run and offers **↻ Reconnect voice DM**, which builds a new
  call and resumes.
- **Who's speaking?** buttons override voice ID for the next turn and show "(no voice)" for players
  who haven't enrolled.
- A physical roll prompt appears when the DM waits on real dice; enter the total there.
- Type to the DM as a player, or whisper instructions the players won't hear.
- Table log: DM speech, player transcripts with speaker labels, rolls and system lines.
- Manual controls:
  - **↶ Undo: <label>** and a **History** dropdown (`HistoryControls.tsx`). The dropdown lists the
    last 50 changes and refetches `GET /api/history` whenever `state.version` changes. Picking an
    entry asks for confirmation, then rewinds to before it.
  - Roll any notation, with quick dice buttons.
  - Damage, heal or remove a target.
  - Start combat, next turn, end combat.
  - **Add NPC**: a name (outline NPCs are suggested) and *follows party* → `add_npc`. The token stands
    next to the party with its own portrait.
  - Rules search.

**🗺 Board** (`board/BoardTab.tsx`, `board/geometry.ts`)
- A 2D grid over the current location's painted map (`mapUrl`, stretched over `gridW × gridH`
  exactly like the TV board). SVG with one unit per cell. It draws the grid, fog cells (dark while
  fog is on, faint while off; host-hidden cells red), map features coloured by kind (entrance
  green, exit cyan, focal gold, feature purple; 💡 lit, ⛔ blocks) and tokens (hidden monsters
  faded with a dashed ring). Features are `effectiveFeatures(state, loc)`, so host fixes show.
- Modes (pointer events with pointer capture; **each drop is exactly one tool call**, so each edit
  is one undo step with a `host:` label):
  - **✋ Move**: drag a token → `move_token`.
  - **☀ Reveal / ☁ Hide**: drag a rectangle → `edit_fog {mode, cells}`. Hidden cells stay dark even
    when party light reaches them, until revealed again.
  - **▣ Features**: click to select, drag to move, drag a corner handle to resize →
    `edit_map_feature update`. The side panel edits name, kind, lit, blocks and x/y/w/h, and has
    **＋ Add feature**, **Delete** and **↺ Use map read** (`reset`: drop host edits). Every
    update/delete sends `expect_name`, so a feature list that changed meanwhile (DM, undo) is
    refused instead of editing the wrong feature. The x/y/w/h fields are raw text while typing;
    *Save* reads them with `boxFromInputs` (an empty field keeps the old value, never 0).
  - **👹 Monsters**: click a token or the list → **Hide/Show** (`set_monster_hidden`) or **Remove**
    (`remove_monster`).
- Fog **on/off** (`set_fog enable|disable`) and **reset** (clears explored and hidden cells), plus
  the same Undo/History controls as the Play tab.
- Host feature fixes and fog painting last until the map is repainted: *Repaint map* always paints
  a new picture and drops them in one undoable step (`map repainted: …`).
- `geometry.ts` is pure (pixel→cell incl. a zero-size board, drag rectangles, move/resize that pull
  off-grid boxes back in, corner hit-testing, `boxFromInputs`)
  and tested in `geometry.test.ts`.

## Client libraries (`src/lib`)

- `api.ts`: a `fetch` wrapper that throws the server's `error` message. When `fetch` itself rejects
  ("Failed to fetch": no server), it throws "Can't reach the game server. Is it running?" instead.
- `useServer.ts`: reconnecting `/ws` hook (role `host`, `table` or `player`) that returns `{connected, campaign, state, dm, speaker,
  jobs, errors, lastEnroll}`. Roll events go to an `onRoll(roll, latestState)` callback, so the
  table can queue animations; `latestState` is the newest `state` event (a ref set before
  `setView`), never a stale render.
- `voice.ts`: `getTableMic`, `MicStreamer` (inline AudioWorklet, 16 kHz PCM16 over `/ws/audio`),
  and `VoiceLink` (RTCPeerConnection plus an `<audio>` sink; POSTs the SDP to `/api/dm/voice`).
  `VoiceLink` rebuilds the call by itself when the peer fails or stays disconnected for 5 s, and
  exposes its state through `subscribe()` (tested in `voice.test.ts` with a fake peer).
- `useServer("table")` plays `npc_speech` clips through `npcAudio.ts` `NpcClipPlayer`: one at a
  time in order; every end, error or blocked autoplay is reported with `POST /api/npc/clip-ended`
  so the DM continues. A muted table (also muted mid-clip) skips clips and reports nothing; the
  server's timeout releases the DM.
