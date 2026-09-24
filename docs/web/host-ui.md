---
title: Host control screen (/host)
area: web
topic: host-ui
related_code:
  - apps/web/src/host/**
  - apps/web/src/lib/**
  - apps/web/src/main.tsx
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Voice link state, Reconnect button, npc_speech playback"
  - "2026-09-24: Initial version"
---

# Host control screen (`/host`)

This page runs on the laptop that has the table mic and speaker. `HostPage.tsx` holds three tabs,
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
- Campaign list: load or delete, and create one (name, party level).
- Story: enter a premise and length, then *Write adventure* (brain). The outline shows the title,
  hook and acts.
- Locations: map thumbnails, *Go here* (`change_scene`), *Paint/Repaint map*, and per-encounter
  *Spawn* buttons.
- NPC list. *End session & write recap* and the list of past recaps.

**🛡 Party** (`PartyTab.tsx`, `CharacterEditor.tsx`)
- Players: add a player, assign a character, and **Record voice** / **Done**. Enrollment happens
  once; re-recording adds a sample.
- Characters: a list with sprite, HP, AC and dice mode. *Edit* opens `CharacterEditor`, the host
  override panel: HP, max, AC, gold, dice mode, conditions and items as clickable chips, appearance
  plus *Redraw sprite*, and delete.
- Add a character in one of three ways:
  - *Build one*: a form with abilities, attacks and inventory as text lines.
  - *Import a sheet*: paste the sheet; the brain parses it.
  - *AI pregens*: set a count and wishes, then *Take for…* a player.

**🎲 Play** (`PlayTab.tsx`)
- Start the voice DM or text-only DM, and stop it.
- While voice is on, a **voice link** pill shows the WebRTC state (`connecting`, `connected`,
  `reconnecting…`, `failed`) with a **↻ Reconnect** button. The DM status pill reads
  "reconnecting…" while the server re-attaches a dropped sideband.
- **Who's speaking?** buttons override voice ID for the next turn and show "(no voice)" for players
  who haven't enrolled.
- A physical roll prompt appears when the DM waits on real dice; enter the total there.
- Type to the DM as a player, or whisper instructions the players won't hear.
- Table log: DM speech, player transcripts with speaker labels, rolls and system lines.
- Manual controls:
  - Roll any notation, with quick dice buttons.
  - Damage, heal or remove a target.
  - Start combat, next turn, end combat.
  - Rules search.

## Client libraries (`src/lib`)

- `api.ts`: a `fetch` wrapper that throws the server's `error` message.
- `useServer.ts`: reconnecting `/ws` hook that returns `{connected, campaign, state, dm, speaker,
  jobs, errors, lastEnroll}`. Roll events go to an `onRoll` callback, so the table can queue
  animations.
- `voice.ts`: `getTableMic`, `MicStreamer` (inline AudioWorklet, 16 kHz PCM16 over `/ws/audio`),
  and `VoiceLink` (RTCPeerConnection plus an `<audio>` sink; POSTs the SDP to `/api/dm/voice`).
  `VoiceLink` rebuilds the call by itself when the peer fails or stays disconnected for 5 s, and
  exposes its state through `subscribe()` (tested in `voice.test.ts` with a fake peer).
- `useServer("table")` plays `npc_speech` clips.
