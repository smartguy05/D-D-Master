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
- `edit_fog` / `edit_map_feature` are host-only (`HOST_ONLY_TOOLS`): never sent to the Realtime DM
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
