---
title: Running a session
area: gameplay
topic: session
related_code:
  - apps/server/src/realtime/instructions.ts
  - apps/server/src/game/service.ts
  - apps/server/src/scripts/seed-demo.ts
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude
status: current
change_log:
  - "2026-10-22: Push-to-talk: the host Talk button on the Play tab; upgrade note (PUSH_TO_TALK=0 restores open mic)"
  - "2026-10-22: Push-to-talk: hold Space on the TV or the phone button; host can switch to open mic"
  - "2026-10-21: Exploration moves (move_party) and exits that lead on"
  - "2026-10-21: The table screen carries the voice DM (mic and DM voice); /host can be closed; enrollment mic button; AI players wait for the DM"
  - "2026-10-21: Long sessions: the voice call renews itself about every 50 min"
  - "2026-10-21: TV sound: the enable-sound button on /table"
  - "2026-10-21: Travel: ready check before change_scene"
  - "2026-10-20: AI players at the table"
  - "2026-10-20: Splitting the party"
  - "2026-10-20: Death rule: party wipe (default) or any death ends the campaign"
  - "2026-10-20: end_campaign saves heroes to the character roster"
  - "2026-10-20: NPC attitudes, Influence and NPC voices"
  - "2026-10-20: Next map prepainted; job elapsed time"
  - "2026-10-20: DM nudged after silent tool results and to end combat"
  - "2026-10-19: Turn limits enforced in combat (turn economy)"
  - "2026-10-19: Muting the table mic for table talk"
  - "2026-10-19: TV join QR (Q) and per-player QR codes"
  - "2026-09-24: Host undo/history, outline editing, export/import"
  - "2026-09-24: Initial version"
  - "2026-09-24: Demo enables fog of war"
  - "2026-10-18: Repaint reads the map and restages the scene"
  - "2026-10-18: The DM finishes its narration before answering"
  - "2026-10-18: Stop talking button"
  - "2026-10-18: Rules engine during play; demo wizard slots"
  - "2026-10-18: NPCs on the map and followers; stalled monster turns"
  - "2026-10-19: Moving next to blocking objects; per-reply move cap"
  - "2026-10-19: Demo fog comes from Location.fog, not set_fog"
---

# Running a session

## Table setup

- **Laptop (host)**: runs the server and has `/host` open. Connect the room speaker and a USB
  conference mic placed in the middle of the table.
- **TV**: the laptop's second screen with `/table` open in the same browser (`localhost`, so the
  mic is allowed). The table screen **carries the voice DM**: it runs the table mic and plays the
  DM's voice, so keep it open; `/host` is only the controls and can be closed or reloaded. (A TV
  browser on another machine, `http://<laptop-ip>:8787/table`, works for the board, but then that
  machine needs the mic and must be allowed to use it.) Press **F** for fullscreen. Before a campaign is loaded the TV shows a big join QR code; during play
  **Q** shows or hides a smaller one. Per-player QR codes are on the host's Party tab.
- **TV sound**: browsers block sound until someone interacts with the page, so the TV shows a big
  **🔊 Click to enable sound** button. Click it (or press any key) once after opening `/table`; it
  comes back if the browser blocks an NPC voice later. **M** or a click on the 🔊 badge mutes the
  TV's sounds. A kiosk Chromium started with `--autoplay-policy=no-user-gesture-required` never
  asks.
- Keep the speaker away from the mic. Browser echo cancellation helps, but distance helps more.

## First session

1. **Adventure tab**: create a campaign and set the party level. Type a premise (anything from one
   line to a paragraph) and choose *Write adventure*. The first location's map paints in the
   background.
2. **Party tab**:
   - Add each player.
   - Choose **🎙 Enable microphone for voice enrollment** (the host laptop's mic, used only while
     recording voices). For each player, choose **Record voice** and have them
     say *"Hi, I'm Sam, and I'm playing Thorin, a dwarf fighter."* (about 5 s), then choose **Done**.
     They never need to say their name again.
   - Create characters in any of the three ways (see [characters](characters.md)) and assign each
     one to a player.
   - Set each character to 💻 virtual or 🎲 physical dice (see [dice-modes](dice-modes.md)).
3. **Play tab**: **🗣 Start voice DM** (open the table screen first; the button is off without
   it). The first time, the browser asks for the mic **in the table tab**: allow it there. The DM
   greets the table, sets the scene and asks what you do.

## During play

- An [AI player](../gameplay/ai-players.md) takes a seat like anyone: it speaks on the TV in its own
  voice on its turn, when you address its character by name, and now and then on its own. The DM
  rolls for it. Pause or nudge it from the Play tab. It never talks over the DM or a person: if
  someone speaks or the DM starts answering first, its line is dropped.
- **Push-to-talk** (on by default, `PUSH_TO_TALK`): to talk to the DM, **hold Space** on the TV
  (for the room), the **🎙 Hold to talk (room)** button on the host's Play tab (for the room too:
  use it when the TV has no keyboard), or the **Hold to talk to the DM** button on your phone, and
  let go when you're done. One person at a time: while someone holds it, everyone sees who. Everything else is table
  talk the DM doesn't hear. The host can switch to an open mic on the Play tab (**✋ Push-to-talk:
  on** → **🎙 Open mic**), where you just talk and voice ID tells players apart.
  *Upgrading from an older version:* push-to-talk is now on by default, so a table that used to just
  talk will find the DM silent until someone holds Space on the TV, the host's Talk button or a
  phone button. Set `PUSH_TO_TALK=0` in `.env` to keep the open mic.
- The DM always finishes what it is saying; anything said over it is still heard and answered as
  soon as it's done.
- To cut the DM off (a rules question, a wrong turn), the host presses **✋ Stop talking** on the
  Play tab.
- To talk among yourselves, **mute the table mic**: **🔇 Mute table mic** on the Play tab, **P** on
  the host laptop or the TV, or the 🎙 button at the top of any phone. The DM hears nothing (it
  finishes a sentence it already started), and the TV shows "The DM isn't listening". Unmute the
  same way; the DM stays quiet until someone speaks to it.
- The DM handles rolls, damage, loot, conditions, monster spawns, initiative and token moves through
  its tools. The TV updates live.
- **Turn limits are enforced** in combat: a creature moves up to its Speed and gets one action, one
  bonus action and one reaction per round. If a player asks for more ("I run 60 feet and attack
  twice"), the tool refuses and the DM says what's left (Dash doubles movement). The TV and the
  phone show what's left this turn. The DM can override for Action Surge or Haste. Your own moves
  from the Board tab are never limited. See [turn economy](turn-economy.md).
- Spells, rests and levels go through the rules engine: the DM's `cast_spell` spends slots,
  `short_rest`/`long_rest` restore what the SRD says, `level_up` adds HP, slots and features, and
  death saves and concentration checks happen on their own (see [rules engine](rules-engine.md)).
  The host can call the same tools via `POST /api/tools/:name`.
- If the DM isn't sure who spoke, it asks naturally. Answering improves that player's voiceprint.
- **Long sessions**: an OpenAI voice call lasts at most 60 minutes, so about every 50 minutes the
  server silently renews it at a quiet moment (nobody talking, the DM done speaking). Nothing
  changes at the table; the log gets "Voice line renewed." Keep the table screen open: it does the
  switch.
- **Closing a tab**: closing `/host` doesn't affect the DM. Closing `/table` ends the voice call;
  reopen it within about 30 s and it rejoins without a new greeting, otherwise press **Start voice
  DM** again. See [voice handover](../server/voice-handover.md).
- **Host powers** (Play tab):
  - Tap a player's name if the DM mixes up speakers.
  - Whisper to the DM ("make the goblins flee", "wrap up this scene", "the players want a shop").
  - Fix numbers in the Party tab editor; the DM sees the change on its next status check.
  - Roll dice, apply damage or heal, and run combat by hand.
  - Search the rules.
  - **Undo** the DM's or your last change (a wrong damage call, a misplaced spawn), or use
    *History* to rewind several steps. The DM gets a note that it never happened.
  - Edit the outline (Adventure tab → *Edit outline*) mid-campaign. The DM's instructions refresh.
- **Splitting the party**: when only some characters go somewhere, the DM moves just them
  (`change_scene` with `character_ids`), or use the per-PC dropdown in *Party & spotlight*. The TV
  shows one group at a time; the DM cuts between them with `focus_scene` (or press **Focus**). A fight
  left mid-way freezes and resumes when its group is back in focus. Each phone shows a map of its own
  character's location. Details: [party split](party-split.md).
- **Moving around a scene**: the DM moves tokens whenever the story moves someone (`move_party`
  for the group, `move_token` for one), so the fog clears as the party explores. If it narrates a
  move without one, the server reminds it once (`[watch]` in the diagnostics). A party that reaches
  an `exit` feature is the cue to move on: the DM is told where it leads and starts the ready check.
- **Travel**: the DM asks the players who are going whether they are ready (the server refuses its
  first `change_scene` until a human player answers, so an AI player can't move the party on
  alone), then calls `change_scene` itself, or you can choose *Go here* on a location. Monsters
  are cleared, the party (and any NPC following it) is placed on the new map, and its map is
  painted if needed. The next outline location's map then paints in the background
  (`PREPAINT_MAPS`, one at a time, continuing from wherever the party is when it finishes; also
  after *Write adventure* and a reset; a failed prepaint isn't retried in the background), so the
  following arrival is usually instant. A forced *Repaint* always wins over an older paint still
  running for the same location. Running jobs show their elapsed
  time on the host.
- **NPCs**: the DM calls `add_npc` when an NPC joins or follows the party. If it forgets, use
  *Add NPC* on the Play tab. *Remove* takes the NPC off the map.
- **Monster turns**: if the DM announces a monster's turn and then goes quiet, the server prompts it
  once to take the turn. If it still stalls, send a host note such as "Run the goblin's turn". It
  is also prompted once when it goes silent after tool results, and reminded to `end_combat` when
  no foe is left standing.
- **NPC attitudes**: every NPC and creature is Hostile, Indifferent or Friendly (2024 SRD) on a
  -5..+5 score (<= -3 Hostile, >= +3 Friendly). The DM calls `adjust_attitude` after gifts, help,
  insults, threats and Influence checks; crossing a threshold changes the creature's side (Hostile
  = foe, Indifferent = neutral, Friendly = ally) and initiative at once, and its token ring flashes
  the new colour. Influence follows the SRD: a Hesitant creature needs a Persuasion, Deception,
  Intimidation or Performance check (Animal Handling for Beasts and Monstrosities) at DC 15 or its
  Intelligence score, whichever is higher, with Advantage if Friendly and Disadvantage if Hostile;
  a failed attempt can't be repeated the same way for 24 hours. `set_disposition` is the hard
  override for sudden flips.
- **NPC voices**: with an OpenAI key the DM voices every quoted NPC line in that NPC's own voice
  on the TV speaker (`NPC_TTS`, on by default; `NPC_TTS=0` turns it off). `add_npc` can give a
  voice direction; otherwise one is generated from the name.
- **Moving next to objects**: levers, wheels and tables usually block their cells. The DM moves a
  token next to one instead, and the server refuses a third move of the same token in one reply. If
  a token ends up in the wrong place, drag it on the Board tab.

## Ending and resuming

- **Adventure tab → End session & write recap**. The brain writes a "previously on…" recap plus DM
  notes, and the DM disconnects.
- Next time, start the server (the last campaign auto-loads) and choose **Start voice DM**. It opens
  with the recap, and enrolled voices are still known.
- To move a campaign to another machine or back it up, use **⇩** in the campaign list, then
  **Import campaign file** on the other side. The import is a new copy with maps, sprites and voiceprints.
- **Death rule** (Adventure tab, *Campaign fails when*): by default the campaign fails only when the
  whole party is dead, so a fallen hero can still be revived (Revivify, Raise Dead, a temple). Choose
  *any character dies* for a harsher game. The server ends the campaign by itself when the rule is
  met, and refuses the DM's `end_campaign` failure before that; **End campaign** on the Play tab
  always works for the host.
- When the story is over, `end_campaign` (the DM or **End campaign** on the Play tab) saves every
  roster-linked hero back to the global [character roster](character-roster.md), and the host page
  offers **Save all to roster** for the rest. In the next campaign, *Party → Add a character →
  Bring an existing hero* brings them back with their level, items, gold and voice.

## Without an OpenAI key

`pnpm --filter @dm/server seed:demo` creates *The Sunken Chapel* demo: 3 characters (Lyra the
Wizard gets her two level-1 spell slots, hit dice and Arcane Recovery from the SRD table), 3 goblins
and a two-room outline. Both rooms have `fog: true`, so fog of war is on in the nave from arrival, with the altar pre-revealed, so one goblin
starts hidden in the dark. Try `POST /api/tools/move_token` or `/api/tools/play_effect` to see the
reveal and the effects on the TV. With an OpenAI key, *Repaint map* on the nave paints it, reads where the
door, altar and lantern are, and restages the scene to match (party at the door, goblins at the
altar, the lantern's glow revealed). Everything except the AI parts works: dice, tokens, combat, rules search
and manual controls. That makes it a good way to test the TV setup.

## Cost notes

Realtime voice is billed per audio minute, typically a few dollars per hour of play at current
pricing. To keep it down:
- Stop the DM during breaks.
- Use text-only mode for prep and testing.
- Keep house-rule files focused. The rules are searched on demand and not put in the prompt, so
  size mostly affects lookup quality.
