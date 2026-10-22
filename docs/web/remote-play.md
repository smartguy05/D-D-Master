---
title: Remote player page (/play)
area: web
topic: remote-play
related_code:
  - apps/web/src/play/**
  - apps/web/src/table/TableScene.tsx
  - apps/web/src/table/rollToast.ts
  - apps/web/src/table/rollToast.test.ts
  - packages/shared/src/say.ts
  - packages/shared/src/say.test.ts
created: 2026-10-22
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Review fixes: server caps/throttles typed input (shared say.ts), TalkPress per-source holds (button and Space), isTypingTarget moved to lib/floor.ts"
  - "2026-10-22: Initial version (online play phase 4: /play/:playerId, TableScene shared with the TV, sheet drawer, push-to-talk, typed input, transcript, NPC clips)"
---

# Remote player page (`/play/:playerId`)

A player who joins **through the tunnel** (see [online play](../setup/online-play.md)) has no TV in
front of them, so `/join` sends them to `/play/:playerId` instead of the phone sheet. The page shows
what the TV shows, plus their own controls:

- **The table scene** in the middle: the same `TableScene` the TV renders (3D board, dice tray,
  moments, effects, initiative strip, Now card, party cards, NPC close-up). The holds that keep the
  board behind the dice are the TV's own (see [table display](table-display.md) and the `tv-timing`
  skill), so a remote player sees the same order of events as the room.
- **Sheet drawer** (left, **📜 Sheet** or **C**, **Esc** closes): the phone sheet (`Sheet` from
  `player/PlayerPage.tsx`: HP, stats, rolls, physical pad, map, spells, inventory, notes, dice
  mode), or the builder draft (`DraftCard`). `sheetAttention` (`play/playView.ts`): the button reads
  **Your turn** on this character's turn and **Your roll!** (pulsing) when the DM waits for this
  character's physical roll, and the drawer opens by itself for the roll, since the number pad is
  in it. Only in the scene the DM is running (party split: the sheet says the roll waits).
- **Push-to-talk**: the phone's `TalkButton` in the dock, and **hold Space** (`isTalkKey`; not while
  typing). Both share one `TalkPress` (`seatTalkPress`), each as its own source
  (`"pointer"`, `"key"`): the press goes when the first one presses and the release only when both
  have let go, so neither ends the other's hold. `isTypingTarget` (`lib/floor.ts`) decides what
  counts as typing for both Space and the page hotkeys. The server marks this holder `inRoom: false` (the socket's origin is remote), so
  the room mic on the TV closes while they hold the floor. A banner at the top says who is talking.
- **Typed input**: "Type to the DM…" sends `POST /api/dm/say {text, playerId}` as this seat (the
  server allows only the bound seat, see [auth](../server/auth.md)). Trimmed and capped at
  `SAY_MAX` (500) characters by `sayText` (`packages/shared/src/say.ts`) on the page and again on
  the server; disabled while the DM is offline. The server also refuses a remote player's text
  within `SAY_MIN_GAP_MS` (2 s) of their last one (429) and while someone else holds the
  push-to-talk floor (409); the error shows under the box.
- **Transcript** (dock, left): the last three DM and player lines from the log (`transcriptLines`;
  roll, system and tool lines are left out, the dice show rolls), and "The DM is speaking…" while it
  talks.
- **Sounds**: dice and effect sounds, moment sounds and NPC clips (`speak_as_npc`) play here too.
  **M** (or the 🔊 badge) mutes this page; a "Click to enable sound" prompt shows while the browser
  blocks autoplay.

## What the page receives

The socket is a player's (`useServer("player")`), so every payload is the server's
[public projection](../server/state-projection.md). The shared scene copes with it:

| Projected | What the scene does |
| --- | --- |
| `combat.turnIndex: -1` (a hidden creature's turn) | `liveTurnId` returns `HIDDEN_TURN` (`table/nowPanel.ts`): the turn marker still waits for the dice (`shownTurn`), no token or card is marked, and the Now card says **Unknown foe**, as the TV does for a hidden monster |
| visible monsters with `ac: 0`, no attacks | nothing reads them: the scene never shows a monster's AC (only PCs' AC badges) |
| secret rolls with zeroed dice and total | `DiceTray` throws no dice for a secret roll (as on the TV); the toast shows the notation and **?** only (`rollToastView`), the same text as the TV |
| only visited locations in `campaign.outline` | the scene looks up the current location, which is always visited |
| no `job` or `error` events | no job chips |

## NPC clips

`useServer(role, …, { playClips })`: the TV plays clips and reports each end
(`POST /api/npc/clip-ended`, which releases the DM). A `/play` page plays them for its player but
never reports: the room's TV does, and that route is table level. When nobody's TV plays a clip, the
server's own timeout releases the DM.

## Not yet (phase 5)

- **The DM's voice and the push-to-talk audio.** A remote player's voice reaches the DM, and the
  DM's voice reaches them, only with the WebRTC call ([online play](../setup/online-play.md), phase
  5). Until then a remote player types to the DM and reads the transcript; holding the talk button
  takes the floor (the room hears it on the TV) but sends no audio.
- **Streaming captions.** The server streams the DM's words as `caption` events only while an NPC
  has the focus (the close-up's subtitles). Narration reaches the transcript as a log line when each
  reply's transcript is final.

## Layout

`play/play.css`, scoped to `.play-root` (the TV's CSS is untouched): the scene's `.table-root` ends
above a 132 px dock; the drawer slides over the map from the left. Below 820 px wide the party
column is hidden and the map takes the width (a phone that opened `/play`); home-network phones
keep `/player`.
