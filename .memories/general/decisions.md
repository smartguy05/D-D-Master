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
