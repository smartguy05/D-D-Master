# Feature: Character creation on phones
Status: done (vertical slice)
Docs: docs/gameplay/phone-creation.md, docs/server/http-api.md, docs/server/auth.md, docs/web/player-view.md, docs/web/host-ui.md

## Overview
Each player creates their own character on `/player/:id` (or in the `/play` drawer):
- **Build** by hand, a stepped form;
- **Chat** with an AI helper that fills the same draft, writes appearance and personality, answers
  SRD questions and draws the portrait;
- **Saved**: pick a roster hero, the player's own first.

The server checks every change against the SRD (`game/creation/validate.ts`).
- A legal character joins at once and is saved to the roster.
- A rule-breaking one goes to the host for approval.
- Phone edits lock when the DM begins a session.

## Notes
- **Data:** drafts live in SQLite `character_drafts`, not GameState. `publicState` is per tier
  (every phone sees the same projection) and undo history would fill with keystrokes. Only a
  content-free `creation` event goes over `/ws`.
- **Server modules:**
  - `game/creation/flow.ts` (`CreationFlow`, `GameService.creation`)
  - `validate.ts` (`resolveChoices`, `rollAbilitySet`, `derivedSummary`)
  - `draft.ts` (`mergeChoices`)
  - `brain/creation-chat.ts` (`runCreationTurn`)
  - SRD: `rules/origins.ts` (species, backgrounds, feats), `rules/equipment.ts` (armor, weapons,
    packages), and the `ClassInfo` extras in `rules/classes.ts`.
- **Shared:** `packages/shared/src/creation.ts` (`CreationChoices`, `CreationDraft`,
  `CreationView`, `CreationOptions`, `SKILL_ABILITIES`, `STANDARD_ARRAY`, `POINT_BUY_COST`).
- **Web:** `apps/web/src/player/creation/` (`useCreation` debounces PATCHes 400 ms and keeps
  locally typed fields over server echoes) and `host/PhoneCreation.tsx`. `CreationSlot` in
  PlayerPage is reused by PlayPage.
- **AI chat:** single-turn per line, with the history serialised into the prompt (12 turns, 600
  characters each, 6000 in all).
  - At most 4 LLM calls per line: the answer, one lookup round, then up to 2 repairs of errors in
    fields the patch set.
  - The patch is merged onto the draft as it is when the reply lands.
  - Empty AI values mean "no change".
- Personality fields (`backstory`, `personality`, `ideals`, `bonds`, `flaws`) are on `Character`
  and `BuilderDraft`. The DM sees a capped `personaLine`.
- The play lock is `Campaign.creation.playStartedAt`, set in `dmHost.opening` (`begin()` only).
- Visual check 2026-10-22 (scratch DATA_DIR, port 8791, Playwright at 390×844 and 1600×900):
  - Chat empty state, Build Origin/Abilities and the preview all rendered.
  - Join turned the draft into a sheet with an Edit button.
  - The host approval card worked, approve saved the hero to the roster, and the Saved tab
    flagged "yours".

## TODOs
- [ ] Live check: chat with the real brain (OpenAI and Anthropic): it keeps to the rules, the repair round works, the portrait draws (see general/live-test-checklist.md)
- [ ] Class choices not modelled: Expertise, Weapon Mastery, Eldritch Invocations, Wizard spellbook beyond prepared spells, tool picks
- [ ] Voice builder: run `resolveChoices` in advice mode on finalize (BuilderDraft holds final scores, so it needs a mapping that doesn't misreport the array/bonus)
- [ ] Optional: a "continue on your phone" hand-off from the voice builder's draft
- [ ] Optional: drafts in campaign bundles (export/import)

## Completed
- 2026-10-22:
  - Phases 1–5 shipped: schema, creation settings and the personality fields; the SRD
    origins/equipment parsers and the validator; drafts, routes, the phone Build/Saved tabs, join
    and edit-before-lock; host approval, settings and the lock; the AI chat helper.
  - The voice builder asks for personality.
