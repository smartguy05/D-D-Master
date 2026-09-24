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
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
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
   red chips.
5. **Combat order**, with the current creature highlighted and your own row outlined.
6. **Roll panel** (virtual dice only). Pick Normal, Advantage or Disadvantage. Then pick a skill, a
   save, an attack (to-hit and damage), or a custom notation and label.
7. **Abilities**: the modifier, the score and the save modifier. The 18 SRD skills, with proficiency
   (from `skills` / `savingThrows`) in gold.
8. Attacks, spells, features, and the **inventory** with expandable descriptions, plus gold.
9. **Dice mode** toggle (📱 Roll here / 🎲 Real dice), background, appearance and notes.

The modifier math is in `apps/web/src/player/sheet.ts` (`skillMod`, `saveMod`, `d20`,
`damageNotation`) and is tested in `sheet.test.ts`. Saving throw proficiencies match on the first
three letters, so `"dex"`, `"DEX"` and `"Dexterity"` all work.

## What a phone may change (read-mostly)

The host keeps authority over HP, inventory, conditions and everything else. A phone has exactly
three write paths (`apps/server/src/routes/player.ts`, checks in `apps/server/src/game/player.ts`):

| Action | Route | Rules |
|---|---|---|
| Roll virtual dice | `POST /api/players/:id/roll {notation, label}` | The player must have a character in virtual mode. It runs `roll_dice` with `roller_id` = the character, so the TV animates it and it is logged. If a DM is running, the DM gets a system note: "Sam as Thorin rolled Stealth: 17" (`GameService.notifyDm`) |
| Answer a physical roll | `POST /api/players/:id/physical-roll {total}` | Accepted **only** when `pendingRoll` is for this player's character. The total must be an integer from -20 to 200. It records the roll through `record_physical_roll` and tells the DM |
| Switch dice mode | `POST /api/players/:id/dice-mode {diceMode}` | Changes only `diceMode` on the player's own character |

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
