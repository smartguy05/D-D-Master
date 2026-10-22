# Live-test checklist (real table session)

Collected 2026-10-21 from the unchecked "live" / "real hardware" / "real TV" TODOs across
`.memories/features/` and `.memories/bugs/`. These need a real OPENAI_API_KEY, the TV laptop, a room
mic, speakers and people, so they can't run in a build sandbox. Each source TODO stays open in its
own file and points here. When a check passes, tick it in the source file and move it to
Completed with the date. Remove it here too, or mark it `[x]`.

## Setup
- The server on the desktop: `pnpm build && pnpm start` (HTTP 8787 + HTTPS 8443). Keep a terminal
  open on its log.
- On the laptop, open `/table` on the TV screen; it owns the call and the mic. Open `/host` in a
  second tab. Players join on their phones from the QR codes.
- Seed or load a campaign with at least one fight, an NPC, a lootable monster, a blocking object
  (lever) and, optionally, an AI seat.

## Log tags to watch (real ones in `apps/server/src`)
| Tag | Where | Means |
|---|---|---|
| `[turn-timing]` | `realtime/session.ts` | per voice turn: speech length and gate decision (noise gate tuning) |
| `[tool]` | `realtime/session.ts` | a DM tool call returned an error (`name(target) -> error`) |
| `[moves]` | `realtime/session.ts` | a move refused by `MAX_MOVES_PER_REPLY` (DM hunting cells) |
| `[stall]` | `realtime/session.ts` | the session nudged the DM (empty reply after tools, stalled turn) |
| `[echo]` | `realtime/session.ts` | a voice turn dropped because it started while a table clip played |
| `[ptt]` | `realtime/session.ts` | a voice turn dropped because push-to-talk is on and nobody held the floor |
| `[handover]` | `game/service.ts` | voice call handover: preparing, swapped, dropped |
| `[ai]` | `players/ai-player.ts` | an AI player line dropped (and why) |
| `[roster]` | `game/service.ts` | a roster auto-save failed at end_campaign |

Example: `pnpm start 2>&1 | tee /tmp/dm.log`, then `grep -E '\[(tool|moves|stall|ai)\]' /tmp/dm.log`.

## 1. Voice call ownership, reconnect, handover
- [ ] The `/table`-owned call on real hardware:
  - the mic prompt appears in the table tab;
  - closing and reopening `/host` mid-game doesn't stop the DM;
  - reloading `/table` resumes without a greeting;
  - the DM's voice plays after the unlock click.

  Sources: bugs/closing-host-kills-dm.md, features/voice-dm.md, features/table-display.md.
- [ ] Voice ID uses the table stream during play and the host stream during enrollment, with two
  streams of the same room at once (bugs/closing-host-kills-dm.md). Enrollment on `/host` must win
  for the whole recording (features/speaker-id.md).
- [ ] Network reconnect: kill the network mid-session. The sideband should reattach to the same
  call_id (retry budget ~31 s), and `?resume=1` should sound natural (features/voice-dm.md).
- [ ] Server restart mid-call: the sideband re-attaches and tools run again. If the call has ended,
  check the lost-call banner and Reconnect (features/voice-dm.md).
- [ ] Mic stream reconnect: restart the server with `/host` open. The pill shows, then clears, and
  voice ID works without a reload (bugs/mic-stream-no-reconnect.md).
- [ ] Handover end to end with `VOICE_HANDOVER_AFTER_MS=120000`:
  - the log shows `[handover]` prepare, then swap;
  - there is no greeting and `active_voice_call.startedAt` is renewed;
  - the browser has no audible gap or double audio;
  - the "Voice ID offline" pill clears after a restart.

  Source: features/voice-dm.md.
- [ ] A real key and real people at a table, overall (features/voice-dm.md).

## 2. Hearing the room: noise gate, mute, echo, speaker ID
- [ ] Noise gate: read the `[turn-timing]` lines and pick a default for `TURN_GATE_TIMEOUT_MS`.
  Coughs and "uh" should get no reply, while "yes", "no" and "six" should. Watch for a hallucinated
  "Thank you." (features/voice-dm.md).
- [ ] Table mic mute: semantic_vad stays quiet while the track is disabled, and muting mid-sentence
  drops the fragment (features/voice-dm.md).
- [ ] NPC clip echo window with real speakers (bugs/npc-clip-mic-echo.md; `[echo]`).
- [ ] Speaker ID with real people and a real room mic: tune the threshold and margin
  (features/speaker-id.md).
- [ ] Roster voice carry-over: save a PC, end the campaign, then join a new campaign. The player
  should be recognised without re-recording (features/character-roster.md).

## 3. NPC voices and close-ups
- [ ] `speak_as_npc` with real speakers (features/voice-dm.md):
  - the clip starts after the DM's audio stops;
  - the DM continues only after the clip;
  - a back-and-forth isn't slow.
- [ ] `npc_focus`: the DM sets and clears it reliably, and the extra round-trip delay is acceptable
  (features/voice-dm.md).

## 4. The DM following the engine (tool discipline)
- [ ] Victory: the DM reads `foes_standing` and keeps the fight going
  (bugs/victory-with-foe-standing.md).
- [ ] A monster turn: the stall nudge doesn't make the DM repeat itself out loud
  (bugs/dm-stalls-on-monster-turn.md; `[stall]`).
- [ ] A PC dies on a failed save and the DM keeps going (bugs/turn-stuck-after-pc-death.md).
- [ ] A blocking object (lever): at most one move, then the action resolves
  (bugs/dm-hunts-cells-around-lever.md; `[moves]`).
- [ ] Movement and turn budget: "I run 60 feet and attack twice" with a level 1 fighter
  (features/turn-economy.md).
- [ ] Loot: kill a goblin. `drop_loot` should come before `remove_monster`, then `pick_up`
  (features/loot-and-interactables.md).
- [ ] NPC attitude: `adjust_attitude` after gifts and insults, with sensible deltas, and Influence
  checks with the right DC (features/npc-attitude.md).
- [ ] Battle intro: the announce line comes before a monster's first attack (features/moments.md).
- [ ] An ending in voice mode: no stuck "pondering" (bugs/dm-stuck-pondering-after-campaign-end.md).
- [ ] The DM stops moving tokens: grep `[tool]` / `[moves]` and find the cause
  (bugs/ai-player-goes-mute.md, still open).
- [ ] Exploration: tokens follow narration (`move_party`) and fog clears; count `[watch]` nudges and
  false positives with `scripts/session_log.py --only diag` (bugs/dm-no-exploration-moves.md).
- [ ] Walking to an exit starts the ready check without host help (bugs/scene-advance-narrated-only.md).
- [ ] `REALTIME_VAD_EAGERNESS=low`: slow speakers aren't answered mid-sentence and latency is OK;
  check `[cutoff]` diag counts (bugs/vad-cuts-slow-speakers.md).
- [ ] The character builder with the real Realtime model (features/characters.md).
- [ ] Campaign outline quality with each brain provider; tune the prompt
  (features/campaign-gen.md).

## 5. TV timing, animation and sound
- [ ] Attack and spell animation timing and sound levels on the real TV (features/table-display.md).
  Also check the DM's voice latency between attack and damage rolls against the grace period
  (bugs/attack-anim-before-damage-dice.md).
- [ ] HP changes and monster removals wait for the dice with the voice DM
  (bugs/hp-and-removal-before-dice.md).
- [ ] The turn marker waits for the dice with the voice DM (bugs/turn-marker-before-dice.md).
- [ ] Moment banners: timings, sound levels, and the tip-over look from the steep camera
  (features/moments.md).
- [ ] "Click to enable sound": one click makes the dice and the next NPC clip audible
  (features/table-display.md, bugs/tv-audio-locked-silently.md).
- [ ] Loot visuals: sack size and bob, aura colour over fog, toast placement
  (features/loot-and-interactables.md).
- [ ] Party split: the TV transition on a focus switch, and phone map legibility on large grids
  (features/party-split.md).
- [ ] Wall detection quality on real painted maps (bugs/attacks-through-walls.md).

## 6. AI players
- [ ] The echo window with real speakers (TV latency, reverb), and whether dropping talk-over hurts
  (features/ai-players.md).
- [ ] Latency per line (model + TTS); tune the AI player model defaults (features/ai-players.md).
- [ ] Floor rules in a chatty table:
  - AI lines are dropped after a person or the DM speaks, but not too often (grep `[ai]`);
  - the VAD/WebRTC window of a few hundred ms is acceptable. If not, try a pre-roll delay.

  Sources: features/ai-players.md, bugs/ai-player-talks-over-dm.md.
- [ ] The ready check: the DM asks naturally and doesn't overuse `forced=true`
  (features/ai-players.md, bugs/ai-player-leaves-without-party.md).
- [ ] The AI close-up shows on the TV and doesn't fight a fresh NPC focus
  (features/ai-players.md, bugs/ai-player-no-closeup.md).

## 7. Online play
- [ ] Cloudflare Tunnel end to end: `cloudflared tunnel --url http://localhost:8787`, `ONLINE_URL` set,
  a friend on another network opens the invite link, joins with the code, picks a seat and rolls
  from `/player/:id`; the startup log shows the code (features/online-play.md).
- [ ] A LAN laptop: `/host` redirects to `/login`, the password works, the cookie survives a restart
  (features/online-play.md).
- [ ] Rotate on the Online card: the remote phone is sent back to `/join`; Kick frees a seat
  (features/online-play.md).
- [ ] Hidden info stays off phones: spawn a hidden ambusher and a secret roll, then check a remote
  and a LAN phone's `/ws` frames (browser devtools) show neither, while the TV plays the same dice
  and moments as before; move to a new location and the phone map appears (features/online-play.md).
- [ ] Push-to-talk in the room: hold Space on `/table` and a LAN phone's button; the DM answers only
  held turns, names the phone's player "(push-to-talk)", ignores side chatter and TV-speaker bleed
  (`[ptt] dropped` lines); releasing doesn't cut the last word (600 ms tail; tune `FLOOR_TAIL_MS`);
  how long after release the turn ends with `REALTIME_VAD_EAGERNESS=low` (features/online-play.md).
- [ ] Push-to-talk on, no `/host` mic: *Record voice* from the table mic succeeds without anyone
  holding Space, and the DM doesn't answer the enrollment sentence (`[ptt] dropped` line); with
  `TRUST_LAN=0` a LAN phone's hold opens the room mic; **Free the floor** on `/host` frees a held
  button (bugs/ptt-enrollment-mic-closed.md, bugs/ptt-in-room-by-access-level.md).
- [ ] Remote `/play` through the tunnel: a friend lands on `/play/<seat>` after `/join` (a LAN phone
  on `/player`); the board, dice and moments match the TV in the same order; holding Space or the
  button shows "… is talking to the DM" on the TV and closes the room mic; typed text reaches the DM
  as that seat; the transcript fills; NPC clips play; the sheet drawer opens on a physical roll
  request (features/online-play.md).
- [ ] Online call through a real tunnel, two different home networks: tiles connect (else add TURN to
  `ICE_SERVERS`); a remote player holding Space is heard by the DM through the TV's mix (and only
  then); remote players hear the DM's voice (forwarded) and NPC clips once each; the TV room hears
  remote players from its speakers without echo loops; "Click to enable sound" on a TV nobody clicked
  switches the call to the mix after the click; mute toward players still lets the DM hear a held
  turn (features/online-play.md).
