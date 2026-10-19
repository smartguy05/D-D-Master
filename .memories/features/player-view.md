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

- Rules state on the sheet (2026-10-18): concentration chip, death-save pips (only at 0 HP; Stable
  and Dead badges), a read-only rules card (slots with pips, Pact row, Hit Dice, resources), and
  spell chips with level badge + C/R tags from `GET /api/players/:id/spells` (`spellSummaries` in
  `game/player.ts`, `GameService.playerSpells`). View helpers are in `player/sheet.ts` and are
  shared with the host Party tab and the TV PartyCard.
- **Decision:** phones do not spend Hit Dice. No "short rest in progress" state exists, and a
  `short_rest` call per die would reset Pact slots and short-rest features each time. The host's
  Short Rest panel picks dice per PC.
- Visual check 2026-10-18: build + `PORT=8798 DATA_DIR=<scratch> pnpm start`, Playwright at 390×844
  (phone) and 1600×900 (TV, host). Screenshots in `.playwright-mcp/rules-ui-*.png` (main repo).

## TODOs
- [ ] Phone spell card: show damage/save at the character's slot levels (cast_spell summary)
- [ ] Undo history labels phone rolls as "host: roll_dice …"; label them "player <name>: …"
- [ ] Phones receive fogged/hidden monsters in state (not rendered); filter per role server-side
- [ ] QR code on the Party tab or the TV (tiny dependency-free encoder)
- [ ] Optional per-player secret/token so players can't open each other's pages
- [ ] Strip hidden monsters and secret rolls from state sent to `player` sockets
- [ ] Player-editable notes (kept separate from host-owned fields)

## Completed
- 2026-10-19: Private **My notes** on the phone: SQLite `player_notes` (not GameState, so the DM
  and other screens never see them), GET/PUT `/api/players/:id/notes`, debounced autosave with a
  local draft. Not in campaign bundles (decide if they should be).
- 2026-10-19: Spell card slot-level table (`atLevels` from `spellLevelRows`): damage/healing per slot
  level, spent levels dimmed, cantrip row at the character level.
- 2026-10-19: Physical pad ⭐ Natural 20 / 💀 Natural 1 toggles (crit/fumble flourish on the TV).
- 2026-10-18: Spell slots, Pact slots, hit dice, resources, concentration and death saves on the
  sheet; spell chips with level/C/R and a tap-for-summary card (new read-only spells endpoint).
- 2026-09-24: /player picker, /player/:id sheet, phone rolls with DM notification, physical number
  pad limited to the pending player, dice-mode toggle, live builder draft card, Party tab link.
