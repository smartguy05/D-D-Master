---
title: Player phone view (/player)
area: web
topic: player-view
related_code:
  - apps/web/src/player/**
  - apps/web/src/host/PlayerLinks.tsx
  - apps/server/src/game/player.ts
  - apps/server/src/game/player.test.ts
  - apps/server/src/routes/player.ts
created: 2026-09-24
last_updated: 2026-10-19
last_audited: 2026-10-19
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-19: Private My notes card (GET/PUT /players/:id/notes, local draft)"
  - "2026-10-19: Spell card slot-level table (atLevels)"
  - "2026-10-19: Physical pad: Natural 20 / Natural 1 toggles for d20 rolls"
  - "2026-10-18: Rules state on the sheet: concentration chip, death-save pips, slots/Pact/hit dice/resources card, spell chips with level badge and C/R tags (GET /api/players/:id/spells); hit dice stay on the host"
  - "2026-09-24: Initial version (sheet, phone rolls, physical number pad, dice mode, builder draft)"
---

# Player phone view (`/player`)

Each player can open their own character sheet on a phone on the same Wi-Fi. The Party tab on
`/host` shows the address (`PlayerLinks.tsx`). When the host runs on `localhost`, it asks the server
for its LAN addresses through `GET /api/player-urls`, for example `http://192.168.1.20:8787/player`.
There is no QR code yet.

- `/player` (`PlayerPicker`) lists the players with their character and sprite. Tap your name. The
  last choice is remembered in `localStorage` (inside try/catch) and highlighted.
- `/player/:playerId` (`PlayerPage`) is that player's sheet. It connects to `/ws` like the host
  (`useServer("player")`), so it updates live on every `state` event.

The page is mobile-first (max 560px wide). Its styles are in `apps/web/src/player/player.css`, and it
uses the color tokens from `styles/app.css`.

## What the sheet shows

Everything is shown in this order.

1. **Header**: character name, species, class and level, player name, the current scene name (from
   the outline location `state.locationId`), a connection dot, and ⇄ to switch player.
2. **"⚔ Your turn!"** banner when combat is active and the current initiative entry is this character.
3. **Physical roll number pad** when `state.pendingRoll.characterId` is this character (see below).
4. **HP bar**: a large bar, green, then gold at 50% or less, then red at 25% or less. It shows
   temporary HP too. Below it are the AC, speed, proficiency bonus and gold tiles, then conditions as
   red chips. Then, when they apply:
   - **◎ Concentrating: <spell>** (cyan chip);
   - **Death saves** box while at 0 HP: 3 success pips (green) and 3 failure pips (red), filled per
     result so far. It becomes a green **✚ Stable** badge when stable, and **☠ Dead** when dead.
   - Below the HP card, a **rules card** (read-only; hidden when there is nothing to show): **Spell slots** per level with
     pips (filled = available) and `left/max`, then the **Pact** row (purple) with a note that Pact
     slots return on a Short Rest; **Hit Dice** `3/5 d8` (left/max); **Features with uses**
     (resources) with pips for pools of 10 or fewer, `left/max` and the reset rule.
5. **Combat order**, with the current creature highlighted and your own row outlined.
6. **Roll panel** (virtual dice only). Pick Normal, Advantage or Disadvantage. Then pick a skill, a
   save, an attack (to-hit and damage), or a custom notation and label.
7. **Abilities**: the modifier, the score and the save modifier. The 18 SRD skills, with proficiency
   (from `skills` / `savingThrows`) in gold.
8. Attacks, spells, features, and the **inventory** with expandable descriptions, plus gold.
   **Spell chips** are sorted by level (cantrips first; unknown spells last) and show a level badge
   (`0` = cantrip, `?` = not in the SRD), a cyan **C** for Concentration and a purple **R** for
   Ritual. Tap a chip for its SRD card (school, casting time, range, duration and summary) and,
   for spells with damage or healing, a **slot-level table** (`atLevels`): one row per slot level
   from the spell's level up to the character's highest slot (`L1 3× 1d4+1 Force`, `L2 4× …`;
   healing adds the spellcasting modifier; "+N targets"), rows without a slot left dimmed; a cantrip
   has one "Now" row at the character's level. The data comes from `GET /api/players/:id/spells`,
   fetched again when the spell list, level, abilities or slots change.
9. **Dice mode** toggle (📱 Roll here / 🎲 Real dice), background, appearance and notes.

The modifier math is in `apps/web/src/player/sheet.ts` (`skillMod`, `saveMod`, `d20`,
`damageNotation`) and is tested in `sheet.test.ts`. The same file holds the pure rules-state view
helpers shared with the host Party tab and the TV: `pips`, `slotRows`, `hitDiceLabel`,
`resourceRows`, `deathSaveView`, `rulesLine`, `characterActions`, `adjustSlots`/`adjustPact`,
`shortRestRows`/`shortRestArgs`, `restSummary`, `toolError`, `levelUpOutcome`, `spellTags` and
`sortSpellNames`. Saving throw proficiencies match on the first
three letters, so `"dex"`, `"DEX"` and `"Dexterity"` all work.

## What a phone may change (read-mostly)

The host keeps authority over HP, inventory, conditions and everything else. A phone has exactly
four write paths (`apps/server/src/routes/player.ts`, checks in `apps/server/src/game/player.ts`):

| Action | Route | Rules |
|---|---|---|
| Roll virtual dice | `POST /api/players/:id/roll {notation, label}` | The player must have a character in virtual mode. It runs `roll_dice` with `roller_id` = the character, so the TV animates it and it is logged. If a DM is running, the DM gets a system note: "Sam as Thorin rolled Stealth: 17" (`GameService.notifyDm`) |
| Answer a physical roll | `POST /api/players/:id/physical-roll {total, natural?}` | Accepted **only** when `pendingRoll` is for this player's character. The total must be an integer from -20 to 200; `natural` (1 or 20, from the pad's ⭐/💀 toggles shown for d20 rolls) is passed on to `record_physical_roll`. It records the roll through `record_physical_roll` and tells the DM |
| Switch dice mode | `POST /api/players/:id/dice-mode {diceMode}` | Changes only `diceMode` on the player's own character |
| Private notes | `GET/PUT /api/players/:id/notes {text}` | The **My notes** card (`PlayerNotes`): autosaves 800 ms after typing stops ("saved ✓" / "saving…" / "offline: kept on this phone"). A local draft (`player/notes.ts`, localStorage `dm.notes.<playerId>`) keeps unsaved text across reloads and wins over the server copy until saved (`chooseNotes`). Stored in SQLite `player_notes`, never in the game state, so the DM, the TV and other phones never see them |

Phones may also **read** spell cards for their own sheet: `GET /api/players/:id/spells`
(`GameService.playerSpells` → `spellSummaries` in `game/player.ts`).

**Decision (2026-10-18): phones do not spend Hit Point Dice.** There is no "short rest in progress"
state, and calling `short_rest` once per die from a phone would also restore Pact slots and
short-rest features every time. The host's Short Rest panel picks the dice for each character and
calls `short_rest` once (see [host UI](host-ui.md)). The phone only shows the dice left.

The host's `POST /api/rolls/physical` uses the same `GameService.submitPhysicalRoll`. It defaults to
the pending character and refuses a different `characterId`. For other characters, use the
`record_physical_roll` tool directly.

There is no authentication: anyone on the LAN can open any player's page (see
[HTTP API](../server/http-api.md)). Phones receive the full `GameState`, including hidden monsters.
The UI does not show them.

## Physical dice number pad

When the DM calls `request_player_roll` for a physical-dice character, that player's phone shows
"🎲 Roll 1d20+2 for Arcana check" with a 3×4 pad (0-9, ±, ⌫) and a **Send** button. After a
successful send, `pendingRoll` clears and the pad disappears. The TV shows the physical roll toast.
The host can still type the total on the Play tab.

## Character builder draft

While the DM builds a character with this player by voice (see
[characters](../gameplay/characters.md#4-build-by-voice-character-builder)), the phone shows a
**"✨ Your new character"** card. It fills in live as `state.builder.draft` changes, and fields not
yet chosen show "…". The phone cannot edit the draft; the host can.
