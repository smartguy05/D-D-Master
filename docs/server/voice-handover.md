---
title: Planned voice-call handover
area: server
topic: realtime
related_code:
  - apps/server/src/game/service.ts
  - apps/server/src/game/service.voice.test.ts
  - apps/server/src/realtime/session.ts
  - apps/web/src/table/useTableVoice.ts
created: 2026-10-21
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude
status: current
change_log:
  - "2026-10-21: The browser side runs on /table (useTableVoice), not /host (bugs/closing-host-kills-dm)"
  - "2026-10-21: Created: silent make-before-break renewal of the Realtime call before its 60 min cap"
---

# Planned voice-call handover

An OpenAI Realtime call ends after 60 minutes. Before that, the server renews it without the
table noticing: it builds a second call next to the live one (make before break), then switches
to it at a quiet moment. The orb and the DM status don't change. The only visible trace is a
"Voice line renewed." system line in the log.

Code: `GameService` in `apps/server/src/game/service.ts` (the handover section after
`startVoice`), `DmSession` in `apps/server/src/realtime/session.ts`, and the browser side in
`apps/web/src/lib/voice.ts` (`VoiceLink.prepareHandover` / `commitHandover`), driven by `/table`
(`apps/web/src/table/useTableVoice.ts`, see [voice ownership](voice-ownership.md)). See
[realtime-sideband.md](realtime-sideband.md) for the call and sideband basics.

## Timing

| Setting | Default | Meaning |
| --- | --- | --- |
| `VOICE_HANDOVER_AFTER_MS` | 3 000 000 (50 min) | Call age from which a handover is prepared at the next quiet moment. |
| `VOICE_HANDOVER_DEADLINE_MS` | 3 420 000 (57 min) | From here the swap no longer waits for a quiet table, only for the DM to stop speaking. |

Call age is measured from `active_voice_call.startedAt` (the `kv` record). A re-attach after a
server restart keeps the original `startedAt`. Each swap writes a fresh record with the new call
id and `startedAt = now`, so the next renewal is counted from the swap. Tests pass shorter values
through `GameServiceOptions.voiceHandover`.

## The quiet check

A watcher runs every `HANDOVER_TICK_MS` (5 s) while a voice DM exists, and stops itself once
there is none. The table counts as quiet when all of these hold:
- `DmSession.isQuiet()`: no response running, playing or queued (`responseActive`, `speaking`,
  `wantResponse`), no tool follow-up pending (`afterTools`), no NPC clip holding responses
  (`holds`), no voice turn waiting on the noise gate, nothing in the outbox, and not reconnecting;
- the NPC clip queue is empty (`npcClips.size === 0`);
- no AI player is deciding or speaking (`AiPlayerController.busy`);
- nobody is talking (`DmSession.userSpeaking`), and the last VAD speech start or stop
  (`lastUserSpeechAt`) is at least `HANDOVER_QUIET_MS` (4 s) old.

## Sequence

1. **Prepare.** The call is past AFTER, the old sideband is open, the table is quiet, and no
   handover is in progress or waiting out a retry. The server broadcasts
   `{ type: "voice_handover", phase: "prepare" }`.
2. **Standby.** `/table` (the page that carries the call) builds a second `RTCPeerConnection` with the mic sender muted
   (`replaceTrack(null)`) and POSTs its offer to `/api/dm/voice?handover=1`.
   `startVoice(sdp, false, true)` does **not** call `stopDm()`. It creates the call, builds a
   standby `DmSession` (with the table mic mute copied) and returns the SDP answer, then opens the
   standby's sideband 250 ms later. `this.dm` stays the old session. A handover POST with no
   prepare pending, or a second one while the first is being created, is refused.
3. **Swap.** The swap happens once the standby's sideband is open and the table is quiet again.
   Past DEADLINE it only waits until the old DM isn't speaking. The swap runs these steps:
   - `standby.refreshInstructions()`, because the call's session was configured when it was
     created;
   - `standby.seedHandover(note)`. This is a system note only, with no `response.create`. The note
     is `HANDOVER_NOTE` ("Same session continuing on a fresh line; don't greet, recap or announce
     anything; carry on exactly where you were.") plus the last 40 DM, player and roll lines (at
     most 8000 characters, `recentPlay(40, 8000)`). The new call's conversation starts empty;
   - `this.dm = standby`, and `setActiveCall({ callId: new, startedAt: now })`;
   - `old.close({ quiet: true })`, which emits no `offline` and marks the old session `handedOver`;
   - a `{ phase: "swap" }` broadcast: `/table` unmutes the new sender, plays the new audio and
     closes the old peer;
   - the "Voice line renewed." system log line.

   The NPC queue, AI players, the NPC close-up (`npcFocus`), the pending ready check and the
   human-input counter all stay as they are.

## Fallbacks

- If the standby sideband isn't open within `HANDOVER_STANDBY_MAX_MS` (20 s) of prepare, or the
  call create, the sideband or the seeding fails, the server closes the standby and broadcasts
  `{ phase: "abort" }`. `/table` then closes its standby peer and keeps the old one. A new attempt
  waits `HANDOVER_RETRY_MS` (60 s).
- With no `/table` page carrying the call, nobody POSTs, so the prepare times out the same way.
- A failed handover POST makes the server abort (the browser sees the HTTP error too).
- If the DM is stopped, a campaign is loaded, or a non-handover `startVoice` arrives (a Reconnect),
  `stopDm()` closes the standby and broadcasts `abort`.
- If the old line goes `offline` for good during a handover, the standby is dropped as well, and
  the usual lost-call banner and Reconnect path apply.
- A standby's errors are logged on the server only. It never reaches the table's error toasts.

## Owner guards

Each `DmSession` gets its own `dmHost(owner)`. While `owner.dm` is not the live `this.dm` (a
standby, or a line that was replaced or retired), its callbacks do nothing:
- `runTool` returns an error ("This voice line is no longer the live DM…") without touching the
  game;
- `onPlayerText`, `onDmText`, `onTurnAccepted`, `onDmCaption`, `onUserSpeech`, `onReplyDone` and
  `onStatus` are ignored.

## Tests

`game/service.voice.test.ts` ("planned voice-call handover") covers these cases:
- prepare only after AFTER and only when quiet (speech, DM audio, an NPC clip, a busy AI player);
- a POST without a prepare is refused;
- the swap seeds without a response, renews the record, retires the old line and keeps the state;
- the standby's tools are ignored;
- a standby that never opens is dropped, then retried after 60 s;
- a failed POST aborts;
- the deadline forces the swap;
- Stop during a handover closes the standby;
- the old line dropping during a handover drops the standby too.

`realtime/session.test.ts` covers the `isQuiet` truth table, speech tracking, `seedHandover` and
`close({ quiet: true })`.

## Known limits

- Not live-tested against OpenAI yet (see `.memories/features/voice-dm.md`).
- The new call only knows the recent play from the note, not the old conversation.
- A tool call that the old line started at the deadline and that finishes after the swap is
  refused by the owner guard.
