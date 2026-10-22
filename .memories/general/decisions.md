# Product decisions (from the initial Q&A, 2026-09-23)

| Question | Decision |
|---|---|
| Play setup | Same room, **one shared mic**. Players say their name **once** (voice enrollment) and are recognized by voice after that |
| Platform | Web app + local Node server; host laptop tab + TV tab |
| Rules | D&D 5e **2024 (SRD 5.2.x)** + a `rules/custom/` folder for house rules |
| Characters | All three: guided/form creation, import sheets, AI pregens |
| Map | AI top-down map on a 3D table plane with a grid + 3D standee tokens |
| Dice | Per player: 3D virtual dice **or** physical dice called out; the DM always uses 3D dice |
| Persistence | Save & resume with an AI recap |
| "Sidecar" | Realtime voice model + separate configurable **brain** LLM (OpenAI or Anthropic) |
| First milestone | Vertical slice: everything basic, then polish |
| Docs | docs/ with audit front matter (≤500 lines per file), docs/index.json + scripts/docs_index.py, .memories/ for features/bugs/general, CLAUDE.md instructions |
| Rules data (2026-10-18) | SRD spells/classes parsed at start into catalogs; types + pure helpers in `packages/shared/src/rules-data.ts` (web can import); `EngineContext.spell`/`classData` are **required** (test stubs return `undefined`); resource reset rules hand-curated from SRD text |
| Rules engine (2026-10-18) | Engine owns death saves + concentration checks automatically; DM/host call cast_spell/rests/level_up. cast_spell spends exactly the requested slot level (no silent upcast), rituals free only with `as_ritual`; one `pendingRoll` slot with `kind`, automatic requests never overwrite another; old saves derived when `hitDice.max === 0` (load + commit) |

User's wording to remember: "Try to be as realistic and human-like as possible" (DM persona), and
"This should all be done using 3D, not vector images" (dice, tokens, board).

## 2026-10-18: Host board edits
- Host map-feature fixes live in `GameState.featureEdits[locationId] = {mapUrl, features}`, not in
  the outline, so they are undoable and `mergeOutline` keeps ignoring client features. They apply
  only while `mapUrl` matches the location's map. A repaint (URL change or forced) also drops the
  entry and that location's explored/hidden fog explicitly (`resetForRepaint`, one undoable
  commit), and a forced repaint always gets a new picture (nonce in the image hash): see
  bugs/repaint-keeps-board-edits.md.
  A first paint (no earlier map) keeps the fog; only a repaint resets it.
- Fog painting: `LocationFog.hidden` overrides auto-reveal (party light and lit features); only an
  explicit reveal (`reveal_area`, `edit_fog reveal`) un-hides. `set_fog reset` and a repaint clear it.
- `edit_fog` / `edit_map_feature` / `edit_walls` (added 2026-10-20) are host-only (`HOST_ONLY_TOOLS`): never sent to the Realtime DM
  and refused from source "dm". `set_monster_hidden` is open to the DM.
- Hidden monsters (`set_monster_hidden`) still roll initiative and act; only the TV hides them
  (`apps/web/src/table/visibility.ts`). The DM and the brain see them flagged `hidden`.
- The TV shows rolls by hidden/fogged monsters as anonymous DM rolls (`rollForTable`), not secret ones.

## 2026-10-18: Attack/spell animation dedupe on the TV, not the server
The engine is pure and has no clock, so `apply_damage` with `source_id` always carries the source
and the table (`table/effectPlan.ts` `travelSuppressed`) drops a travel for a source→target pair
that already travelled within 1.5 s. Plans are fixed per effect id when first placed.

## 2026-10-20: Test-run findings decisions (user)
- Targeted d20 attack rolls with no dc are checked against the target's AC (nat 20/1 rule for
  attacks only; labels with save/check/contest are not attacks).
- Host tool calls reach the live DM as silent "Host did: …" system notes (no spoken reply).
- Physical-dice players roll their own damage (pending roll kind `damage`).
- Allies drop Unconscious at 0 HP (never die from damage; the DM removes them); story NPCs join
  initiative only with `combatant: true`; `set_disposition` foe/ally/neutral + host button.
- Spell effects stay named conditions, linked via `conditionMeta` (source spell/concentration,
  rounds, end of turn) instead of `cast_spell` owning buffs.
- Gold is whole numbers; `split_gold` splits a reward. Reset loads the first outline location.
  Maps of linked locations are painted ahead of time (PREPAINT_MAPS).

## 2026-10-20: NPC attitude scale and NPC voices (Phase 4, user)
- NPC attitude is a gradual -5..+5 score on the 2024 SRD attitudes with thresholds <= -3 Hostile,
  -2..+2 Indifferent, >= +3 Friendly. `adjust_attitude` moves it; crossing a threshold flips the
  disposition through the same code as `set_disposition`, which stays the hard override. The fields
  are optional and derived from the old flags for saved campaigns. Influence uses the SRD rules as
  written (DC 15 or the creature's Intelligence, Advantage/Disadvantage by attitude), not a made-up
  per-attitude DC.
- The DM voices every quoted NPC line through TTS (`speak_as_npc`); `NPC_TTS` is on by default and
  still needs OPENAI_API_KEY. NPCs without a voice direction get a deterministic generated one
  (`defaultNpcVoice`), no LLM call.

## 2026-10-20: Global character roster (Phase 5, user)
- The roster is global (one per server), not per campaign; deleting a campaign never touches it.
- A hero's voiceprint is carried over: copied to `roster_voiceprints` on save and into the new
  campaign's `voiceprints` on join (unless that player already has one there).
- Bundle export/import keeps `Character.rosterId`, but import never writes the roster tables.
- Roster portraits are copied to `<dataDir>/roster/assets/<rosterId>.png` (campaign folders are
  deleted with their campaign) and served as `/media/roster/<rosterId>.png`.
- Linking a character's `rosterId` is a committed change without an undo entry; joining from the
  roster is undoable. `end_campaign` auto-saves only linked PCs; the host is prompted for the rest.

## 2026-10-20: Campaign death rule (user)
- When deaths end a campaign is a per-campaign setting (`Campaign.deathRule`), not a global one.
- The default is `party_wipe`: the campaign fails only when every PC has the Dead condition.
  `any_death` fails it on the first PC death, with no grace period for revival.
- The server enforces the rule. It auto-ends the campaign and refuses the DM's early
  `end_campaign` failure. The host's End campaign always overrides, including for story failures
  while PCs live.

## 2026-10-20: Party split model (user + design)
- User choices: each group has its own combat; the TV shows one scene **in focus**, chosen by the
  DM (`focus_scene`) or the host (Focus button); a fight cut away from freezes exactly and resumes;
  splitting via `change_scene` + `character_ids` or the host's per-PC dropdown; groups merge when
  they share a location; the phone map is view-only, own location, no secrecy (no per-client
  filtering); the DM gets full detail for the focus plus one line per other group.
- "Swap on focus": the top-level `locationId/tokens/monsters/combat/pendingRoll` stay the focused
  scene and other groups are parked in `GameState.scenes`, so the engine and the TV needed almost
  no changes. Rejected: a location on every token/monster plus per-location combats (every engine
  helper would have needed scene filtering).
- Tools naming an away PC (move, attack, cast, pick up) are **refused**, not auto-focused, so the
  TV never jumps without the DM or host meaning it to.

## 2026-10-21: HTTPS on a second port with an auto self-signed certificate (user)
- The user runs the server on a desktop and uses a laptop as host controls + TV. Browsers allow
  `getUserMedia` only on https or localhost, so the laptop's `/host` needs https.
- Chosen: keep plain HTTP on `PORT` (8787) for phones and any TV, and add an HTTPS listener on
  `HTTPS_PORT` (8443) with the same routes and sockets over one GameService (`app.ts` `buildApp`
  built twice, one shared `createSockets` pair). Phones' QR codes stay on http, so no phone sees a
  certificate warning; only the laptop accepts it once.
- The certificate is self-signed and made automatically (`tls.ts`, `selfsigned@5.5.0` pinned) in
  `<dataDir>/certs` with SANs localhost, 127.0.0.1 and every LAN IPv4; it is remade when a new LAN
  address appears (old addresses kept) or 30 days before its 825-day expiry. `HTTPS_CERT` +
  `HTTPS_KEY` (e.g. mkcert) override it. Rejected: HTTPS only (every phone would need to accept
  the cert) and a mandatory mkcert setup (extra install step on two machines).
- If the HTTPS listener fails to start, the server warns and stays up on HTTP.

## 2026-10-21: consult_brain and image timeouts (plan)
- `consult_brain` has its own provider (`createConsultProvider`, `CONSULT_TIMEOUT_MS` = 30 s)
  instead of the 15-minute brain timeout: the voice DM waits on it live. A timeout or error is a
  tool result ("improvise from the outline and carry on"), never a throw.
- Image requests: `IMAGE_TIMEOUT_MS` (5 min) on the client with one retry, and `withDeadline` over
  the whole call with an abort signal.

## 2026-10-21: /table carries the voice call; /host is controls only (user)
- Closing the host tab used to kill the DM (bugs/closing-host-kills-dm.md). The user chose: the
  `/table` page **always** owns the WebRTC call, the table mic and the DM's audio; `/host` only
  sends commands (`voice_command` via `/api/dm/voice/start|reconnect`, `/api/dm/stop`) and shows
  the state (`voice_owner`).
- Voice-ID **enrollment stays on `/host`** with its own mic stream (`/ws/audio?role=host`), which
  the server uses only while a voice is being recorded.
- Both tabs run on the same laptop (`localhost`, so `getUserMedia` is allowed).
- Accepted limit: closing `/table` still ends the call; it auto-resumes if reopened within ~30 s.

## 2026-10-21: AI players never talk over the DM or a person
- The table has the floor: an AI line not yet heard is dropped when someone speaks or the DM starts
  a response, and an AI clip waits while the DM is busy (dropped after 15 s). A line already
  playing is heard out. See bugs/ai-player-talks-over-dm.md.

## 2026-10-22: Online play access (phase 1)
- **A Cloudflare Tunnel makes every request look like localhost** (cloudflared connects to
  `http://localhost:8787`). So "from 127.0.0.1" can't mean "the host". `CF-Connecting-IP` (always set
  by Cloudflare, a client can't remove it) marks a tunnelled request as remote. `X-Forwarded-For`
  from a local proxy counts by its last hop and can only lower trust. See docs/server/auth.md.
- Levels: this machine = host (`HOST_LOCAL_BYPASS`), the home network = table + any seat
  (`TRUST_LAN`), a table-code cookie = its own seat, a `HOST_PASSWORD` cookie = host. Everything under
  `/api` is host-only unless allowlisted in `auth/access.ts`, keyed on Fastify's route pattern.
- One HMAC-signed cookie (`node:crypto`, no new dependency). Revocation without a list: a bound
  player cookie is valid only while its sign-in id holds the seat; rotating the code bumps a
  generation; host cookies carry a password fingerprint.
- A fixed `TABLE_CODE` can't be rotated from the UI (it would come back on restart); changing it in
  `.env` signs players out at the next start.
- Deviations from the plan text: any `X-Forwarded-For` is not automatically remote (Vite's `xfwd`
  dev proxy and Caddy/nginx forward LAN clients); a player on another seat's route gets 403, not 401
  (so the page doesn't bounce to `/join`); the cookie carries a `sid` and the seat claim replaces a
  revoked-id list.
- Review fixes (same day): `ONLINE_URL` is the tunnel address and `PUBLIC_URL` stays the LAN address,
  because in-room QR codes through the tunnel would make phones remote. Only a loopback proxy may
  name the client address (rate-limit key). The limiter counts IPv6 per /64 and has a global budget
  (100 failures / 10 min pause sign-in for everyone: an attacker can lock out remote joins for 10
  minutes, which beats a guessable code). Codes became WOLF-RUNE-7342 (23 million). A seat held by
  a sign-in with no socket for 2 minutes can be taken over by a new sign-in with the code (the code
  holder is trusted anyway; this saves the host a Kick when a player switches browsers).

## 2026-10-22: Hidden information is filtered on the server (online play phase 2)
- **Viewer tier = access + clamped hello role.** A player cookie is always `public`; a host or
  table (trusted LAN) socket is `full` when it says hello `host`/`table` and `public` when it says
  `player`. So LAN phones on `/player` get the public view, and the TV keeps the full state and its
  own render-time filtering (its dice and moment timing don't change). A LAN device that says hello
  `table` gets the full state: that is what `TRUST_LAN` trusts; turn it off for a strict room.
- Host/table sockets get their snapshot **after their hello** (the tier depends on it), before the
  hello listeners run. Until then they get public events only. Clients always send hello on open.
- Stripped fields that the schema requires get neutral values (`ac: 0`, `attacks: []`,
  `initiativeBonus: 0`, `attacksPerAction: 1`) instead of being deleted, so the wire type stays
  `GameState` and no client code meets `undefined`.
- A hidden creature's current turn becomes `turnIndex: -1` (nobody's turn) rather than pointing at a
  neighbour, which could tell a player "your turn".
- Unvisited locations are dropped from the public campaign entirely (not just their prompts); a new
  location's map arrives with a campaign re-sent before the state that reaches it.
- Phone roll replies are trimmed for callers below the host (`seatRollReply`), not by changing the
  tool results (the DM and host still need `vs_ac` and hints).
- The visibility rules moved to `packages/shared/src/visibility.ts` (one implementation for the TV
  and the server); `apps/web/src/table/visibility.ts` re-exports them.

## 2026-10-22: Push-to-talk floor (online play phase 3)
- **Push-to-talk for everyone, the room included** (user decision). With it on, the DM hears a voice
  turn only if someone held the floor during it; with it off (`PUSH_TO_TALK=0` or the host toggle),
  in-person play is the open mic it was (voiceprints, noise gate), and the floor is unused.
- **Two layers against the room mic reaching the DM.** `/table` disables the mic track while the
  room doesn't hold the floor (browser gate), and the session drops any committed turn no hold
  covers (server gate, `DmHost.outsideFloor`). The server gate is what catches **TV-speaker echo**
  and side chatter that leak through anyway (e.g. a browser that ignores `track.enabled`, or the
  DM's own reply played into the open mic during a hold's tail). It works like the clip echo gate
  but needs no clip timing: no hold, no turn.
- **The floor lives in `GameService`, not the session**, so the live and the standby (handover)
  sessions share it, and speaker ID uses it without voiceprints (remote players never enroll).
- **Seat checks on the server** from the socket's access (`Hub.accessOf`): a player cookie presses
  only for its bound seat (a different `playerId` is refused, not rewritten); a table-access socket
  (LAN phone, TV) for any human seat; only a `/table` or `/host` hello presses for the room. Only the
  pressing socket can release; its close releases. `inRoom` = the press came from a table-access
  socket, so only in-room holds open the room mic (remote voices come through the phase 5 mixer).
- First press wins; no queue. A repeat press keeps the hold's start (no cap reset by key repeat).
  30 s auto release. The 600 ms tail covers the VAD's `speech_stopped`, which comes after release.
- The toggle is runtime only (like the mic mute); a restart goes back to `PUSH_TO_TALK`.
- Tests that exercise open-mic behaviour pass `pushToTalk: false` to `GameService` explicitly,
  since the default comes from config (on).


## 2026-10-22: Remote player page /play (online play phase 4)
- **One scene, two pages.** `TablePage` was split into `table/TableScene.tsx`: `useTableScene(role)`
  holds the `/ws` connection and every dice hold (moved verbatim; planners unchanged) and
  `TableScene` draws; `TablePage` (TV) and `play/PlayPage` (remote) add their own controls in slots
  (`banners`, `controls`, `corner`) placed where the TV's elements were, so the TV's DOM order and
  stacking are unchanged. A hook (not a render-prop component) so `useTableVoice` and the hotkeys
  stay in `TablePage` and its effects keep their order.
- **Hidden turn on a projected state.** `turnIndex: -1` becomes the `HIDDEN_TURN` marker
  (`nowPanel.ts liveTurnId`), not `undefined`: `shownTurn` releases `undefined` at once, which would
  have dropped the turn marker before the dice landed on `/play`. The Now card shows "Unknown foe",
  as the TV does for a hidden monster.
- **Landing page by origin.** `/join` sends a `remote` origin to `/play/:id`, the home network and
  this machine to `/player/:id` (`seatPage`). `/play` is still reachable from the LAN by URL.
- **No DM audio or streamed captions in phase 4.** Captions are only broadcast while an NPC has the
  focus; remote players read the DM's replies from the log (`transcriptLines`) and type to the DM.
  The push-to-talk button is there (it takes the floor, `inRoom: false`) but carries no audio until
  the phase 5 WebRTC mixer.
- **NPC clips on /play** play locally but never report `clip-ended` (table route; the room TV reports).
- **One `TalkPress` per page** shared by the Space key and the button (`seatTalkPress`), with a
  set of sources (`"key"`, `"pointer"`): one down when the first presses, one up when the last lets
  go, so neither releases the other's hold.
- **Typed input is limited on the server** (`SAY_MAX`, `SAY_MIN_GAP_MS` in shared `say.ts`; no
  typing over another floor holder for seat-bound callers): a remote cookie can't flood the log,
  the state broadcast or the DM's turn. The page's cap only mirrors it. The cap and throttle apply
  to seat-bound callers only: the host's PlayTab line is sent in full (it types for a seat on
  purpose). The throttle slot is stamped only after `sendText` succeeds, so a send refused while the
  DM reconnects can be retried at once.

## 2026-10-22: WebRTC call, webcams and the DM mix (online play phase 5)
- **Full mesh, server relays signaling only.** At most 5 remote players + the room, so every member
  connects to every other one (no SFU, no new dependency). The server (`rtcRelay.ts`) decides
  membership and relays `rtc` signals between members only. The room is one `/table` (the voice
  owner, else the first table to join; a new room screen gets a new peer id). A remote player is a
  `player` socket from a `remote` origin (`Hub.inRoom` false), bound to its cookie's seat. LAN phones
  and `/host` never join. The payload is checked (`rtcSignal`), with a 120 per 10 s rate, and the Hub
  drops messages over 64 KB.
- **Three fixed slots, no renegotiation.** The impolite side (peer id order) adds mic / dm / cam
  transceivers in that order; the polite side answers with the same three. A track's meaning is its
  transceiver index, and every change is a `replaceTrack` (camera off, character instead, mute toward
  players, the DM track after a handover). Perfect negotiation is kept for safety and ICE restarts.
- **The DM hears the mix only when needed.** Without remote players `/table` sends the bare room
  mic as before (no WebAudio, so an in-room game can't be broken by a suspended AudioContext). With
  remote players and a running context it sends `DmMixer`'s output (`VoiceLink.replaceStream`). The
  room mic is gated on its track as before; remote gains follow the floor (`gainPlan`, tail
  `FLOOR_TAIL_MS`). If the context is suspended, the room mic keeps going and the TV asks for a
  click. The mixer's output stream lives as long as the page, so reconnect, resume and handover keep
  their own logic.
- **The DM's voice forward is only the OpenAI track** (`VoiceLink.onRemoteStream`). NPC clips stay
  local `<audio>` on each page (`/play` already plays `npc_speech` URLs), so nobody hears a clip twice
  through the call.
- **The room mic toward players is a second capture**, not the DM-gated track: players hear the
  table's free talk while push-to-talk keeps the DM's ear closed. The table mute (P) is about the DM;
  the room tile's 🎙 mutes the room toward the players.
- **Muted toward the players still reaches the DM**: while holding the floor (plus tail) the mic goes
  to the room only (`slotTrack`, `holdsOwnFloor`).
- **Defaults:** `/play` camera on (the prompt comes at once), `/table` camera off; 360p and 300 kbps
  through `setParameters`; prefs per device in localStorage (try/catch).

## 2026-10-22: Character creation on phones
- **The user chose** (with the alternatives they turned down):
  - **A server validator with host overrides**, not prompt-only rules.
  - **The host sets the creation rules per campaign** (starting level = `partyLevel`, ability
    methods, homebrew), not each player.
  - **Valid characters join immediately**, without host approval for every character. Invalid ones
    can be sent to the host with a note.
  - **The Saved tab lists the whole roster**, with the player's own flagged, rather than only their
    own.
  - **Edits only until play starts**, rather than "flavour always" or "never".
  - **Auto-save to the roster on join**, rather than opt-in.
  - **AI chat scope:** appearance and portrait, personality fields, a live preview with switching to
    Build, and SRD answers.
- **Drafts live in SQLite, not GameState.** The player projection is per tier, so per-seat drafts
  in GameState would leak to every phone, and undo would fill with keystrokes. A content-free
  `creation` event plus seat REST instead.
- **The draft stores choices; the server derives the stats.** Base scores, background bonus,
  picks and packages go in; HP, AC, saves, attacks, spells and features come out. That leaves far
  less to validate than checking hand-entered numbers.
- **The play lock is set at `begin()`**, not at the first tool call or by hand. Old campaigns lock at
  their next session start instead of guessing from the log.
- **The voice builder is unchanged** (no validator): its draft holds final scores, so the array and
  bonus checks would misreport.

## 2026-10-22: Product name is Hearthmaster
- The software is called **Hearthmaster** (lowercase m, as in the marketing files; first used in
  the demo video, 2026-10-19). README, CLAUDE.md, docs, page titles and headings, root
  `package.json` name (`hearthmaster`), the self-signed TLS cert commonName and the server start
  log all use it. Existing cached certs keep the old commonName until they renew; that's harmless.
- A name check on 2026-10-22 found no tabletop/AI-DM product with that name: only an old
  Hearthstone bot (hearthmaster.wordpress.com), a gas valve tool, and "Hearth", an agentic
  game-dev app.
- "Dungeon Master"/"DM" stays as the in-game role (persona, PlayTab heading), not the product name.

## 2026-10-22: Voice ID test is read-only, one control for the party
- Party tab **Test voice ID**: Start + Done (as enrollment), not auto-stop after a fixed time, and
  not a continuous "name every turn" mode.
- The result shows the best match (✓ confident / "not sure") **and** every player's score, rather
  than only the name.
- **Read-only**: a test never merges into a voiceprint. "Yes / No, it was …" correction buttons
  were rejected: re-record a misheard player instead.
- The DM ignores words said during a test (and now during enrollment too), rather than hearing them
  as a normal turn.
