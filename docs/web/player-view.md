---
title: Player phone view (/player)
area: web
topic: player-view
related_code:
  - apps/web/src/player/creation/*
  - apps/web/src/player/TalkButton.tsx
  - apps/web/src/player/playerMap.ts
  - apps/web/src/player/PlayerMap.tsx
  - apps/web/src/lib/TurnBudgetChips.tsx
  - apps/web/src/player/**
  - apps/web/src/host/PlayerLinks.tsx
  - apps/server/src/game/player.ts
  - apps/server/src/game/player.test.ts
  - apps/server/src/routes/player.ts
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Header avatar (Character.spriteUrl, or the initial in the token color); a tap opens the portrait full screen with name and appearance"
  - "2026-10-22: Creation panel, edit button, personality on the sheet"
  - "2026-10-22: TalkButton: refused presses retried (seatTalkPress), last-10 s countdown and expired state"
  - "2026-10-22: Doors: doorVisible now comes from @dm/shared; the server already sends only walls next to seen cells (state-projection.md)"
  - "2026-10-22: MicToggle shown only with table or host access (canMuteRoom); mic is a table route, not a seat route"
  - "2026-10-22: TalkButton holds the shared TalkPress as the \"pointer\" source (Space on /play is \"key\")"
  - "2026-10-22: Sheet and DraftCard exported for the /play drawer; TalkButton takes a shared TalkPress (seatTalkPress); remote players land on /play (remote-play.md)"
  - "2026-10-22: TalkButton lets go when push-to-talk turns off mid-press (TalkPress); in-room by origin"
  - "2026-10-22: Hold to talk to the DM button (TalkButton.tsx) while push-to-talk is on"
  - "2026-10-22: Phones get the public projection of state and campaign (server-side filtering); roll replies trimmed"
  - "2026-10-22: Access: phone routes need the seat (table-code cookie bound to it, or the LAN/host); /join for remote players; a 401 goes to /join"
  - "2026-10-21: Audit: phone map auras have one style; /api/player-urls also returns hostUrls (https host links)"
  - "2026-10-20: Party split: header shows the PC's own location; PlayerMap (view-only map of it); paused fight and waiting roll notes"
  - "2026-10-20: tableRulesView helper for the TV party card"
  - "2026-10-20: Inventory shows item icons (Item.iconUrl)"
  - "2026-10-20: Damage pad: critical toggle"
  - "2026-10-19: QR codes exist (removed \"There is no QR code yet\")"
  - "2026-10-19: Turn budget chips in the Your turn banner; off-turn reaction line"
  - "2026-10-19: Header mic mute toggle (MicToggle)"
  - "2026-10-19: Private My notes card (GET/PUT /players/:id/notes, local draft)"
  - "2026-10-19: Spell card slot-level table (atLevels)"
  - "2026-10-19: Physical pad: Natural 20 / Natural 1 toggles for d20 rolls"
  - "2026-10-18: Rules state on the sheet: concentration chip, death-save pips, slots/Pact/hit dice/resources card, spell chips with level badge and C/R tags (GET /api/players/:id/spells); hit dice stay on the host"
  - "2026-09-24: Initial version (sheet, phone rolls, physical number pad, dice mode, builder draft)"
---

# Player phone view (`/player`)

Each player can open their own character sheet on a phone on the same Wi-Fi. The Party tab on
`/host` shows the address (`PlayerLinks.tsx`). When the host runs on `localhost`, it asks the server
for its LAN addresses through `GET /api/player-urls`, for example `http://192.168.1.20:8787/player`. Player links stay on plain HTTP; the same response's
`hostUrls` lists the `https://<ip>:HTTPS_PORT/host` links for a laptop host (see [install and run](../setup/install-and-run.md)).
Under **Show join QR codes** the Party tab has one QR code per player that opens their own sheet, and
the TV shows a `/player` QR on its waiting screen (and on **Q**); see [host UI](host-ui.md).

- `/player` (`PlayerPicker`) lists the players with their character and sprite. Tap your name. The
  last choice is remembered in `localStorage` (inside try/catch) and highlighted.
- `/player/:playerId` (`PlayerPage`) is that player's sheet. It connects to `/ws` like the host
  (`useServer("player")`), so it updates live on every `state` event.

A player who joined **through the tunnel** lands on `/play/:playerId` instead (the TV scene plus
this sheet in a drawer, see [remote play](remote-play.md)); `/join` picks the page from
`/api/auth/me`'s `origin` (`seatPage` in `lib/auth.ts`). `Sheet` and `DraftCard` are exported for
that drawer, and `TalkButton` takes an optional shared `TalkPress` (`seatTalkPress`) so `/play`'s
Space key and button press as one.

The page is mobile-first (max 560px wide). Its styles are in `apps/web/src/player/player.css`, and it
uses the color tokens from `styles/app.css`.

## What the sheet shows

Everything is shown in this order.

1. **Header**: the character's avatar, character name, species, class and level, player name, the
   current scene name (from the outline location `state.locationId`), a connection dot, and ⇄ to
   switch player. The avatar (`Avatar`) is the portrait `Character.spriteUrl` in a 48 px circle. A
   tap opens it full screen with the name and the `appearance` line. A tap anywhere, ✕ or Escape
   closes it. Without a portrait yet (still drawing, images off) it shows the first initial in the
   token color and can't be tapped; the picture appears live when the sprite lands.
2. **"⚔ Your turn!"** banner when combat is active and the current initiative entry is this character.
   It shows the turn budget chips (movement left, Action, Bonus, Reaction; see
   [turn economy](../gameplay/turn-economy.md)). Off-turn in combat the phone says "↺ Reaction ready"
   or "Reaction used this round".
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
8. Attacks, spells, features, and the **inventory** with expandable descriptions, plus gold. An
   item with an `iconUrl` (drawn when it was dropped as loot) shows a small icon before its name.
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
`resourceRows`, `tableRulesView` (the TV's active card), `deathSaveView`, `rulesLine`, `characterActions`, `adjustSlots`/`adjustPact`,
`shortRestRows`/`shortRestArgs`, `restSummary`, `toolError`, `levelUpOutcome`, `spellTags` and
`sortSpellNames`. Saving throw proficiencies match on the first
three letters, so `"dex"`, `"DEX"` and `"Dexterity"` all work.

## Map and party split (`PlayerMap.tsx`, `playerMap.ts`)

A **Map** card (below the HP card) shows a view-only top-down map of the character's **own**
location, even when the TV shows another group ([party split](../gameplay/party-split.md)): the
painted picture, that location's fog, visible doors (`doorVisible`; the projected walls hold only
segments next to seen cells), loot and interactable auras, and the tokens the
table may see (hidden or unseen monsters are left out). Your token has a pulsing gold ring; tap a
token for its name; *Zoom to me* shows a 12×12 window around you (`viewWindow`).

The header 📍 is your own location. When your group's fight is frozen (the DM is with another
group), "⏸ Paused" replaces "Your turn!" and the reaction line; a physical roll asked for in your
parked scene shows "waits for the DM" instead of the number pad.

## What a phone may change (read-mostly)

The host keeps authority over HP, inventory, conditions and everything else. A phone has exactly
five write paths (`apps/server/src/routes/player.ts`, checks in `apps/server/src/game/player.ts`):

| Action | Route | Rules |
|---|---|---|
| Roll virtual dice | `POST /api/players/:id/roll {notation, label}` | The player must have a character in virtual mode. It runs `roll_dice` with `roller_id` = the character, so the TV animates it and it is logged. If a DM is running, the DM gets a system note: "Sam as Thorin rolled Stealth: 17" (`GameService.notifyDm`) |
| Answer a physical roll | `POST /api/players/:id/physical-roll {total, natural?}` | Accepted **only** when `pendingRoll` is for this player's character. The total must be an integer from -20 to 200; `natural` (1 or 20, from the pad's ⭐/💀 toggles shown for d20 rolls) is passed on to `record_physical_roll`. It records the roll through `record_physical_roll` and tells the DM |
| Switch dice mode | `POST /api/players/:id/dice-mode {diceMode}` | Changes only `diceMode` on the player's own character |
| Talk to the DM (push-to-talk) | `/ws` `{type:"ptt", down, playerId}` | The big **Hold to talk to the DM** button pinned to the bottom (`player/TalkButton.tsx`), shown only while push-to-talk is on. Pressing takes the floor if nobody holds it; it shows "Sam is talking to the DM" while someone else does. Released on pointer up/cancel, when the page hides, and when push-to-talk is turned off mid-press (`lib/floor.ts` `TalkPress`, so the button works again once it is back on). A press the server refused (someone held the floor, or its throttle) is sent again once the floor is free (`seatTalkPress` retries; a floor it was given is never re-taken). In the last 10 s before the 30 s cap the label counts down ("(7 s left)"); held past the cap it says "Time's up: let go and press again" (red, dashed). The phone's hold reaches the TV's room mic only once the server's floor comes back (only the TV's own Space opens it at once). A home-network phone's hold opens the room mic (by its origin, even signed in with the code); a remote player's doesn't. See [push-to-talk](../server/realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts) |
| Mute the table mic | `POST /api/players/:id/mic {muted}` | The header 🎙 / **🔇 DM off** button (`MicToggle`). It mutes the **whole room**, so it is a table route: shown only with table or host access (a home phone under `TRUST_LAN`), from `/api/auth/me` (`lib/auth.ts` `canMuteRoom`); a player-level phone would get a 401 and be sent to `/join`. The log says who |
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

**Access** ([authentication](../server/auth.md)). With `TRUST_LAN` on (the default), any phone on
the home network can open any player's page and use its routes, as before. A remote player joins at
`/join` with the table code and picks a seat; their cookie is bound to that seat, so the seat routes
(`roll`, `physical-roll`, `notes`, `spells`, `dice-mode`) answer 403 for any other seat. A 401
(no or expired sign-in, kicked, code rotated) sends the page to `/join?next=…`. Phones (the page says
hello `player`, so LAN phones too) receive the **public projection** of the state and campaign: no
hidden or fogged monsters, no monster stat blocks, secret roll totals, hidden objects, unvisited
locations or plot notes ([state projection](../server/state-projection.md)). A roll POST answers
only the total.

## Physical dice number pad

When the DM calls `request_player_roll` for a physical-dice character, that player's phone shows
"🎲 Roll 1d20+2 for Arcana check" with a 3×4 pad (0-9, ±, ⌫) and a **Send** button. After a
successful send, `pendingRoll` clears and the pad disappears. The TV shows the physical roll toast.
The host can still type the total on the Play tab. For a damage roll (`kind: "damage"`) the pad
reads "💥 Roll 1d8+3 damage" and has a **💥 Critical hit** toggle instead of the natural 20/1
toggles, preset when the roll is already critical (the DM said so, or the player's attack just
before showed a natural 20); it is sent as `critical`.

## Character builder draft

While the DM builds a character with this player by voice (see
[characters](../gameplay/characters.md#4-build-by-voice-character-builder)), the phone shows a
**"✨ Your new character"** card. It fills in live as `state.builder.draft` changes, and fields not
yet chosen show "…". The phone cannot edit the draft; the host can.

## Creating a character

Without a character, the page shows the creation panel (Chat, Build, Saved). With a phone-made
character it shows "✎ Edit <name>" until play starts. The voice builder's draft card wins while the
DM is building for this seat. Components: `player/creation/` (`CreatePanel`, `BuildForm`, `ChatTab`,
`SavedTab`, `DraftPreview`, `useCreation`, pure `view.ts`), wired through `CreationSlot` in
`PlayerPage.tsx`. The sheet's About section shows the personality fields (`personaRows`). See
[phone creation](../gameplay/phone-creation.md).
