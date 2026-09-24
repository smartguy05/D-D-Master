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
