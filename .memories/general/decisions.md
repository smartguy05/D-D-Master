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
