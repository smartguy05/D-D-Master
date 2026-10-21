---
title: AI players
area: gameplay
topic: ai-players
related_code:
  - apps/server/src/players/**
  - apps/web/src/host/PartyTab.tsx
  - apps/web/src/host/PlayTab.tsx
  - apps/server/src/game/readyCheck.ts
created: 2026-10-20
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Clip queue link points to realtime-audio-and-turns.md (sideband doc split)"
  - "2026-10-21: The table has the floor: tableBusy, interrupt(), clips wait on DmSession.busy and drop after 15 s, the DM holds from clip start (bugs/ai-player-talks-over-dm)"
  - "2026-10-21: Ready check window and late-transcript yes (bugs/ready-check-stale-pending, bugs/ready-check-late-yes); AiPlayerController.busy; a line past AI_SPEAK_MAX_MS drops its late clip"
  - "2026-10-21: AI player lines take the TV close-up with the character's sprite and subtitles (bugs/ai-player-no-closeup)"
  - "2026-10-21: Voice can't block the line: AI_SPEAK_MAX_MS and a TTS deadline (bugs/ai-player-goes-mute)"
  - "2026-10-21: Ready check before change_scene; AI players suggest leaving, never decide it (bugs/ai-player-leaves-without-party)"
  - "2026-10-20: Created: AI-controlled seats (Player.ai), AiPlayerController, own voice, AI_PLAYER_* config, echo gate, host Pause/Nudge"
---

# AI players

An AI can fill a seat at the table. It plays its character like a person would: it hears the
game (as text), decides what its character says or does, and speaks that line on the TV in its
own voice. The DM then gets the same line as a typed player line. The AI never calls tools; the
DM resolves its actions and rolls for it.

## Setting one up (host)

- **Party → Players at the table**: type a name and press **🤖 Add AI player**, or tick **🤖 AI**
  on an existing player. Give the seat a character as usual (form, pregen, roster, import).
- The persona box on the AI's row ("bold dwarf who loves a fight, protects the wizard") sets its
  personality and playstyle, and colours its speech voice.
- AI players have no voiceprint (the enrollment buttons are hidden). The "only one player has a
  character" speaker-ID shortcut counts only human players.
- **Play → AI players**: each AI's status (idle / thinking / speaking, with the last line),
  **⏸ Pause / ▶ Resume** and **👉 Nudge** (say or do something now).

## When an AI player acts (`players/ai-player.ts`)

`DmSession` calls `DmHost.onReplyDone` after every finished DM reply (no tool calls left). The
`AiPlayerController` then picks **at most one** AI seat (`pickAiTurn`). Only seats that are AI,
not paused, with a living character in the focused scene count (`activeAiSeats`).

1. **combat_turn**: the current initiative entry is its character and it hasn't acted on this
   turn (`round:turnIndex`). It must speak.
2. **addressed**: a new DM or player line speaks to it: a sentence with its character name (full
   or first) or player name that is a question, opens with the name ("Mira, …"), or says "your
   turn" / "you're up". Narration that only mentions it ("Thorin's axe bites deep") doesn't count.
   Out of combat, a DM question to the whole party ("What do you do?", "Anyone?") also counts, for
   the AI who spoke least recently. The model may pass (`speak: false`).
3. **spontaneous**: out of combat, after a DM line, when no AI spoke for
   `AI_PLAYER_SPONTANEOUS_COOLDOWN_MS` (90 s). The model is told to speak only if its character
   would naturally chime in.
4. **nudge**: the host button (`POST /api/players/:id/ai/nudge`). It ignores the cooldown, not the
   pause. It must speak. It is refused while an AI is deciding or the table is busy ("The DM is
   answering or someone is talking; try again in a moment.").

One decision runs at a time. A reply that finishes meanwhile is looked at afterwards. A line is
**dropped** when the table moved on while the model was thinking (a new log entry or the turn
changed; nudges only check the turn), so the AI never answers a stale question.

## The table has the floor

An AI line never talks over the DM or a person. Before this fix a human spoke, the DM began
answering (a response running, no audio yet) and the AI clip played anyway
(bugs/ai-player-talks-over-dm):
- `host.tableBusy()` is `DmSession.busy` (a response running or queued, a tool follow-up, someone
  talking, a turn on the noise gate; see [realtime audio and turns](../server/realtime-audio-and-turns.md#npc-clip-queue-no-overlap-with-the-dm)).
  `run()` makes no model call while it is true, and drops a finished line if it became true.
- `interrupt(reason)` aborts the line in flight (a per-run `AbortController`, also used for the
  `AI_SPEAK_MAX_MS` timeout with reason `"timeout"`). `GameService` calls it on every
  `DmHost.onResponseStart` ("the DM is responding") and on `onUserSpeech(true)` ("someone at the
  table spoke") unless `npcClips.echoAt(now)` says it is the clip's own echo.
- An aborted line that wasn't heard yet is dropped: its slot is cancelled, nothing is sent to the
  DM, the combat turn is not spent, and the log gets `[ai] <name>: line dropped (<reason>)`. A line
  already playing is heard out and still goes to the DM; so does a timed-out one (as text).
- In the clip queue a `pc` clip waits while the DM is busy and is dropped after 15 s
  (`DM_BUSY_MAX_WAIT_MS`). `host.speak` returns whether the clip was heard (`playOnSlot` awaits
  `slot.started`).
- The DM holds its next response (`holdResponses(slot.done)`) from the moment the clip starts, not
  from the reserve: a hold queues responses, which would make the DM busy and the clip wait forever.
- Left over: a few hundred ms of VAD/WebRTC latency before `speech_started` reaches the server.

## What the AI sees (`aiPlayerPrompt`)

- **System**: it is a player at an in-person table playing the character, plus the persona and the
  rules: first person, 1–3 short sentences, declare intent only, never roll or invent results,
  never act for others, never decide for the party to leave (suggest it and ask).
- **Character sheet** (`characterSheet`): class/level, HP, AC, speed, abilities, saves, skills,
  attacks, spells, slots and resources (`rulesSummary`), features, conditions, inventory.
- **Board**: `partyStatus()` JSON (the DM's `get_party_status`: positions, monsters, map
  features, doors, combat order and turn budget, map objects).
- **Transcript**: the last 40 DM, player and roll log entries.
- The reply is `{speak, line}` via `completeJson` (`AiPlayerReply`); lines are capped at 400
  characters.

## How it is heard

1. The line plays on the table speaker: `GameService.speakAiLine` reserves a slot on the NPC clip
   queue (after the DM's audio stops and the DM is no longer busy, one clip at a time) and synthesizes it with
   `NpcVoice.synthesizeWith` in the seat's `aiVoice` and `aiVoiceDirection` (persona). The event
   is the usual `npc_speech` with `npcName` = the character's name plus `portraitUrl` (the
   character's `spriteUrl`) and `pc: true` (`playOnSlot`'s `speaker` argument), so `/table` plays it
   and shows the character's close-up with the line as subtitles, the way an NPC line looks (see
   [table display](../web/table-display.md#npc-close-up-npccloseuptsx-captionts)).
2. When the clip has played, `GameService.sendText(line, playerId)` logs it as
   `"<player> as <character>"`, announces the speaker and sends it to the DM as typed input.
3. With speech off (no key, `NPC_TTS=0`) or a failed synthesis the DM still gets the text.
   Speech is time-limited on two levels. Synthesis has a deadline (`NPC_TTS_TIMEOUT_MS`, see below). The
   controller also waits at most `AI_SPEAK_MAX_MS` (90 s) for `speak()`, then warns and sends the text.
   A stalled speech request used to leave the seat "speaking" with nothing heard. `busy` also stayed
   set, so no AI acted for minutes (bugs/ai-player-goes-mute).

**Leaving a place** (`game/readyCheck.ts`): an AI saying "let's move on" never moves the party by
itself. The DM's `change_scene` is refused with a ready check while a human player's character
would leave, until a human says something after the refusal (an answered voice turn, counted by
`DmHost.onTurnAccepted` even before its transcript arrives, or a typed line not from an AI seat:
`GameService.humanInputs`). AI lines don't count. The answer must come within 5 minutes and 8 human
lines of the ask; a stale check is asked again, and any party move clears it. The persona tells the DM to ask every
player who is going; `forced: true` (a trapdoor) and AI-only groups skip the check.

**Echo gate**: the TV speaker is heard by the shared mic. `NpcClipQueue.echoAt(ts)` is true while
a clip plays and for `ECHO_TAIL_MS` (400 ms) after it. `DmSession.onCommitted` drops a voice turn
whose speech started then (like a muted turn: the audio item is deleted, no note, no reply, no log).
This covers NPC clips too. A person talking over a clip is dropped as well.

## Voices

`pickAiVoice` picks from the built-in speech voices, never `REALTIME_VOICE` (the DM), and one no
other AI player has while any is free. It is stored in `Player.aiVoice` when AI is turned on.
NPC voices are hashed over the same pool, so an NPC can share an AI's voice; the voice direction
still differs.

## DM side (`realtime/instructions.ts`)

The PARTY list tags AI seats "(AI player)", and an **AI PLAYERS** block tells the DM: their lines
arrive as typed player lines; on their turn ask and wait; roll for them with `roll_dice`
(`roller_id` = their character id), never `request_player_roll`; don't decide for them.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AI_PLAYER_PROVIDER` | `BRAIN_PROVIDER` | `openai` or `anthropic` |
| `AI_PLAYER_MODEL_OPENAI` | `gpt-5-mini` | OpenAI model (reasoning effort `low`) |
| `AI_PLAYER_MODEL_ANTHROPIC` | `claude-haiku-5-5` | Anthropic model |
| `AI_PLAYER_TIMEOUT_MS` | `20000` | Per decision (one SDK retry) |
| `AI_PLAYER_SPONTANEOUS_COOLDOWN_MS` | `90000` | Least time between unprompted lines |

## Limits

- Not live-tested yet with real speakers and a room: the echo window, TTS latency per line and
  how chatty `spontaneous` feels need a real session.
- The AI can't answer a DM roll request on its own; the DM is told to roll for it.
- An AI seat in a group that is not in focus (party split) stays silent until that scene is
  focused.

## Tests

`apps/server/src/players/ai-player.test.ts` (triggers, prompt, controller, interrupts and busy drops),
`apps/server/src/game/service.ai-players.test.ts` (voice, speaker ID, instructions, interrupt wiring,
hold from clip start), `apps/server/src/realtime/session.test.ts` (echo drop, onReplyDone, `busy`,
`onResponseStart`), `apps/server/src/realtime/npc-queue.test.ts` (`echoAt`, pc clips on a busy DM,
`started`).
