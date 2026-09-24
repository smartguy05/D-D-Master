# Feature: Player phone view (/player)
Status: done (vertical slice)
Docs: docs/web/player-view.md, docs/server/http-api.md

## Overview
Each player opens `/player` on their phone, picks their name, and gets their character sheet at
`/player/:playerId`: a big HP bar, AC/speed/PB/gold, conditions, the scene, combat order with a
"your turn" banner, abilities, saves, skills, attacks, spells, features and inventory. It is
**read-mostly**: a phone can only
- roll virtual dice (skills, saves, attacks, custom), which the TV animates and the DM is told about,
- answer its **own** pending physical roll on a number pad,
- switch its own dice mode.

## Notes
- Server: pure checks are in `apps/server/src/game/player.ts`. Service methods are `playerRoll`,
  `submitPhysicalRoll`, `setPlayerDiceMode` and `notifyDm`. Routes are in
  `apps/server/src/routes/player.ts`, registered from `api.ts` with one line.
- Phone rolls reuse `roll_dice` via `runTool(…, "host")`, so they are logged as host tool events.
- `notifyDm` uses `DmSession.prompt`, so the DM responds. The note says "React only if it matters".
- Phones use the same `/ws` broadcast, so they receive the whole state (hidden monsters too). The
  UI doesn't show secrets, but a curious player could read them. That is fine on a trusted LAN.
- Player styles are kept in `apps/web/src/player/player.css` (not app.css) to avoid merge churn.
- `/api/player-urls` lists LAN IPv4 addresses for the Party tab hint. There is no QR code yet.
- Visual check: `DATA_DIR=<tmp> seed:demo`, `pnpm build`, `PORT=8791 pnpm start`, then Playwright
  at 390×844. The picker, sheet, number pad and builder draft all rendered correctly.

## TODOs
- [ ] QR code on the Party tab or the TV (tiny dependency-free encoder)
- [ ] Optional per-player secret/token so players can't open each other's pages
- [ ] Strip hidden monsters and secret rolls from state sent to `player` sockets
- [ ] Spell slots, hit dice and death saves on the sheet once the schema has them
- [ ] Player-editable notes (kept separate from host-owned fields)

## Completed
- 2026-09-24: /player picker, /player/:id sheet, phone rolls with DM notification, physical number
  pad limited to the pending player, dice-mode toggle, live builder draft card, Party tab link.
