# Bug: closing the /host tab takes the DM offline
Status: fixed (2026-10-21)
Area: web, server

## Overview
Closing (or reloading) the `/host` tab mid-game ended the voice DM: the table heard nothing more
and no tools ran until the host reopened the page and pressed Start.

## Repro
1. Open `/host` and `/table`, start the voice DM.
2. Close the `/host` tab.
3. The WebRTC call, the mic and the DM's audio go with it; the DM is offline.

## Root cause / Fix
Root cause: `VoiceLink` (the WebRTC call, the mic and the DM audio) lived only in `HostPage`.

Fix (user decisions: `/table` ALWAYS owns the call; `/host` is controls only; voice-ID enrollment
stays on `/host`; both tabs on the same laptop, `localhost`):
- Shared: `VoiceLinkState` moved to `@dm/shared`; `VoiceOwnerView {table, link, error?, micStream}`;
  ServerEvent `voice_owner` (in the snapshot) and `voice_command {start|stop|reconnect}` (only to
  the owner table); ClientEvent `voice_link {state, error?}`. `voice_handover` is now consumed by
  `/table`.
- `Hub` records roles from `hello`; `onClientEvent`, `onClose`, `send(ws, ev)`, `roleOf`, `withRole`.
- `game/voice-owner.ts` (pure): `pickAudioSource` (host while enrolling if the host streams, else
  table, else host), `pickVoiceOwner` (the table whose call is up, else the newest), `voiceOwnerView`.
- `/ws/audio?role=host|table` (default table); `GameService.audioSocket` counts; `pushAudio(chunk,
  source)` drops the non-picked source (accepts all when none tracked). `SpeakerService.enrolling`
  (cap `ENROLL_MAX_MS` 120 s).
- `GameService.requestVoice("start"|"reconnect")` → `voice_command` to the owner table; throws
  "Open the table screen (/table) first…" with none. `stopDm()` also sends `stop` (else the call
  keeps talking with no tools); `startVoice` uses `stopDm({keepCall: true})`.
- Routes: `POST /api/dm/voice/start`, `POST /api/dm/voice/reconnect`. The SDP POST to
  `/api/dm/voice` now comes from `/table`.
- Web: `MicStreamer(role)`, `audioSocketUrl`, `VoiceLink.resume(stream)` (`?resume=1`, state
  reconnecting), `VoiceLink.active`, `MicStreamer.resume()`; `playRemote` reports a refused
  `play()` (`onRemoteAudioBlocked` → `markAudioLocked`) and `retryRemoteAudio()` on unlock.
  `useServer`: `view.voiceOwner`, `onVoiceCommand`, `sendToServer`.
- `table/useTableVoice.ts` owns the link, the table mic + `MicStreamer("table")`, reports
  `voice_link`, runs commands and the handover, applies the mic mute, re-reports after a `/ws`
  reconnect and auto-resumes once per page load (`voicePlan.shouldAutoResume`). TablePage voice
  pill; unlock overlay "Click to enable sound and the DM's voice".
- Host: no VoiceLink; `MicControl` is the enrollment mic only (`MicStreamer("host")`, "Enable
  microphone for voice enrollment"); pills "Voice ID offline", "Enrollment mic offline —
  reconnecting", red "table screen closed: open it ↗"; PlayTab Start/Reconnect call the new routes,
  read `view.voiceOwner`, and Start voice is disabled with a notice when no table screen is open.

## Notes
- Known limit: closing `/table` still ends the call (it carries it). Reopened within the sideband
  retry window (~30 s) it auto-resumes without a re-greeting; otherwise the host presses Start.
- The first mic permission prompt now appears in the table tab.
- Docs: docs/server/voice-ownership.md (new), host-ui.md, table-display.md, http-api.md.

## TODOs
- [ ] Live-test on real hardware: two tabs on one laptop (table on the TV screen), mic prompt in
      the table tab, close and reopen `/host` mid-game (DM keeps talking), reload `/table` (it
      resumes without a greeting), autoplay unlock for the DM's voice.
- [ ] Check voice ID during play uses the table stream and enrollment the host stream (two
      streams of the same room at once).

## Completed
- 2026-10-21: `/table` owns the call (useTableVoice, voicePlan), Hub roles, voice-owner.ts,
  voice_owner/voice_command/voice_link, audio source pick, requestVoice + routes, stopDm hangs up
  the table. Tests: hub.test.ts, voice-owner.test.ts, service.table-voice.test.ts,
  voicePlan.test.ts, voice.test.ts.
