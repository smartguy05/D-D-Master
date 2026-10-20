---
title: Running a session
area: gameplay
topic: session
related_code:
  - apps/server/src/realtime/instructions.ts
  - apps/server/src/game/service.ts
  - apps/server/src/scripts/seed-demo.ts
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
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
- **TV**: a browser at `http://<laptop-ip>:8787/table`. Press **F** for fullscreen. Before a campaign is loaded the TV shows a big join QR code; during play
  **Q** shows or hides a smaller one. Per-player QR codes are on the host's Party tab.
- Keep the speaker away from the mic. Browser echo cancellation helps, but distance helps more.

## First session

1. **Adventure tab**: create a campaign and set the party level. Type a premise (anything from one
   line to a paragraph) and choose *Write adventure*. The first location's map paints in the
   background.
2. **Party tab**:
   - Add each player.
   - Choose **🎙 Enable table microphone**. For each player, choose **Record voice** and have them
     say *"Hi, I'm Sam, and I'm playing Thorin, a dwarf fighter."* (about 5 s), then choose **Done**.
     They never need to say their name again.
   - Create characters in any of the three ways (see [characters](characters.md)) and assign each
     one to a player.
   - Set each character to 💻 virtual or 🎲 physical dice (see [dice-modes](dice-modes.md)).
3. **Play tab**: **🗣 Start voice DM**. The DM greets the table, sets the scene and asks what you do.

## During play

- Just talk. The DM always finishes what it is saying; anything said over it is still heard and
  answered as soon as it's done.
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
- **Host powers** (Play tab):
  - Tap a player's name if the DM mixes up speakers.
  - Whisper to the DM ("make the goblins flee", "wrap up this scene", "the players want a shop").
  - Fix numbers in the Party tab editor; the DM sees the change on its next status check.
  - Roll dice, apply damage or heal, and run combat by hand.
  - Search the rules.
  - **Undo** the DM's or your last change (a wrong damage call, a misplaced spawn), or use
    *History* to rewind several steps. The DM gets a note that it never happened.
  - Edit the outline (Adventure tab → *Edit outline*) mid-campaign. The DM's instructions refresh.
- **Travel**: the DM calls `change_scene` itself, or you can choose *Go here* on a location. Monsters
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
