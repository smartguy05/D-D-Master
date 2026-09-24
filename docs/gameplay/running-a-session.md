---
title: Running a session
area: gameplay
topic: session
related_code:
  - apps/server/src/realtime/instructions.ts
  - apps/server/src/game/service.ts
  - apps/server/src/scripts/seed-demo.ts
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version"
  - "2026-09-24: Demo enables fog of war"
---

# Running a session

## Table setup

- **Laptop (host)**: runs the server and has `/host` open. Connect the room speaker and a USB
  conference mic placed in the middle of the table.
- **TV**: a browser at `http://<laptop-ip>:8787/table`. Press **F** for fullscreen.
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

- Just talk, and interrupt freely. The DM stops when someone speaks over it.
- The DM handles rolls, damage, loot, conditions, monster spawns, initiative and token moves through
  its tools. The TV updates live.
- If the DM isn't sure who spoke, it asks naturally. Answering improves that player's voiceprint.
- **Host powers** (Play tab):
  - Tap a player's name if the DM mixes up speakers.
  - Whisper to the DM ("make the goblins flee", "wrap up this scene", "the players want a shop").
  - Fix numbers in the Party tab editor; the DM sees the change on its next status check.
  - Roll dice, apply damage or heal, and run combat by hand.
  - Search the rules.
- **Travel**: the DM calls `change_scene` itself, or you can choose *Go here* on a location. Monsters
  are cleared, the party is placed on the new map, and its map is painted if needed.

## Ending and resuming

- **Adventure tab → End session & write recap**. The brain writes a "previously on…" recap plus DM
  notes, and the DM disconnects.
- Next time, start the server (the last campaign auto-loads) and choose **Start voice DM**. It opens
  with the recap, and enrolled voices are still known.

## Without an OpenAI key

`pnpm --filter @dm/server seed:demo` creates *The Sunken Chapel* demo: 3 characters, 3 goblins
and a two-room outline. The nave has fog of war on, with the altar pre-revealed, so one goblin
starts hidden in the dark. Try `POST /api/tools/move_token` or `/api/tools/play_effect` to see the
reveal and the effects on the TV. Everything except the AI parts works: dice, tokens, combat, rules search
and manual controls. That makes it a good way to test the TV setup.

## Cost notes

Realtime voice is billed per audio minute, typically a few dollars per hour of play at current
pricing. To keep it down:
- Stop the DM during breaks.
- Use text-only mode for prep and testing.
- Keep house-rule files focused. The rules are searched on demand and not put in the prompt, so
  size mostly affects lookup quality.
