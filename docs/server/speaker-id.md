---
title: Speaker identification (voiceprints)
area: server
topic: speaker-id
related_code:
  - apps/server/src/game/floor.ts
  - apps/server/src/speaker/**
  - apps/server/src/game/voice-owner.ts
  - apps/server/src/scripts/eval-voiceid.ts
  - scripts/download-models.sh
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Push-to-talk holder comes first in identifySpeaker and liveSpeaker; a room hold falls through; the table mic stream is silent without the floor"
  - "2026-10-21: Capture comes from /table during play and /host while enrolling (/ws/audio?role, pickAudioSource, SpeakerService.enrolling, ENROLL_MAX_MS)"
  - "2026-10-20: One-player shortcut counts only human players (AI players excluded)"
  - "2026-10-20: eval-voiceid campaign literal gains deathRule (type only)"
  - "2026-10-19: Live who's talking (LiveTalk, provisional voice ID, talk event)"
  - "2026-09-24: Initial version; 30/30 on synthetic 6-speaker eval"
---

# Speaker identification (voiceprints)

**Goal:** players say their name **once**. After that, the DM knows who is talking from a single
shared table mic.

## Pipeline

1. **Capture.** The `/table` page (which carries the voice call) streams the table mic to
   `/ws/audio?role=table`; `/host` streams its own mic (`?role=host`) for enrollment. An
   AudioWorklet downsamples it to 16 kHz mono PCM16 in 100 ms chunks. Only one source feeds the
   ring (interleaved chunks would garble it): `pickAudioSource` (`game/voice-owner.ts`) takes the
   host stream while `SpeakerService.enrolling` (from `startEnrollment` to `finishEnrollment`,
   capped at `ENROLL_MAX_MS`, 120 s) and the host streams, else the table stream, else the host
   stream; `GameService.pushAudio(chunk, source)` drops the other. The server writes it into `AudioRing`, a 90-second
   buffer stamped with server wall-clock time.
2. **Enrollment** (Party tab → *Record voice*). `startEnrollment` notes the time. The player says
   "Hi, I'm Sam, playing Thorin…" for about 5 s, and *Done* calls `finishEnrollment`. That slices
   the ring from the start time to now, `trimSilence` keeps 30 ms frames above 12% of the peak
   energy, and at least 1.5 s of speech is required. The clip is embedded and merged into the
   voiceprint.
3. **Embedding.** sherpa-onnx `SpeakerEmbeddingExtractor` with `models/wespeaker_en_voxceleb_resnet34.onnx`
   (256-dim). It is loaded through `createRequire`, and if the native module or model file is
   missing, `available` is false.
4. **Storage.** The `voiceprints` table holds the L2-normalised running mean of the samples (capped
   at 50), stored per campaign and player, so returning players are recognised next week.
5. **Identification** (every committed voice turn). Audio from `[speech_started − 450 ms,
   speech_stopped]` is trimmed; at least 0.6 s of speech is needed. It is embedded, then
   `matchSpeaker` computes cosine similarity against every voiceprint.
   - **Confident** means score ≥ `SPEAKER_THRESHOLD` (default 0.45) **and** a lead of ≥ 0.06 over
     the runner-up.
   - Confident: the note is `[speaker: Sam as Thorin, confidence 0.83]`, the table highlights that
     card, and `activeSpeaker` is set.
   - Not confident: the note is `[speaker: unknown, possibly … ask if unclear, then call confirm_speaker]`,
     and the embedding is kept as `lastUnconfirmed`.
6. **Learning from corrections.** When the DM asks "Was that Thorin or Lyra?" and calls
   `confirm_speaker`, the kept embedding is merged into that player's voiceprint.

## Overrides and shortcuts (`GameService.identifySpeaker`)

In this order:
- **Push-to-talk** (`PUSH_TO_TALK` on): the player who held the floor longest during the turn's
  window (plus the 600 ms tail) is the speaker, note `[speaker: Sam as Lia (push-to-talk)]`, no
  voice ID needed (remote players never enroll). A hold by the room (`/table` Space) says nothing
  about who spoke and falls through to the rules below. See
  [push-to-talk](realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts).
- A host tap on a **Who's speaking?** button applies to the next turn that ends within 20 s.
- If only one **human** player has a character, voice ID is skipped ([AI players](../gameplay/ai-players.md)
  never talk into the mic and don't count; the same rule applies to the live who's-talking guess).
- With no voiceprints, or no model, the DM gets `[speaker: unknown …]` and asks when it matters.

## Live who's talking (`speaker/live.ts`)

`LiveTalk` lights up the talker on the TV **while** they speak, before the turn ends:
- `DmSession` calls `DmHost.onUserSpeech(true/false)` on Realtime `speech_started` /
  `speech_stopped`. In between, every mic chunk that `GameService.pushAudio` keeps goes to
  `LiveTalk.onAudio`.
- It broadcasts `{type:"talk", talk:{who:"player", active, level?, playerId?, provisional?}}`:
  start/stop, and the mic level (`pcmLevel`: RMS, square-rooted and scaled to 0–1) at most every
  `LEVEL_EVERY_MS` (125 ms).
- After `LIVE_ID_AFTER_MS` (1.2 s) of speech it asks `GameService.liveSpeaker` over the last
  `LIVE_ID_WINDOW_MS` (3 s): the push-to-talk holder (a player, not the room), the host's tap, the only player with a character, else
  `SpeakerService.identify`. A **confident** match is sent as `playerId` + `provisional: true`.
  It retries every 1 s until sure, then every 2.5 s. Unsure matches are not shown.
- `liveSpeaker` has no side effects (no `speaker` event, no `activeSpeaker`, no sample kept). The
  turn's `identifySpeaker` still decides who acted.

Each live ID is one embedding over ≤ 3 s of audio on the server's event loop, about once a second
while someone talks.

## Measured accuracy

`pnpm --filter @dm/server eval:voiceid` (after `bash scripts/download-models.sh --with-tts`)
enrolls 6 synthetic VCTK voices from **one sentence each**, then identifies 5 new sentences per
voice through the real ring → trim → embed → match path.
Result on 2026-09-24: **30/30 correct, all confident**, with scores 0.70–0.93 and margins 0.13–0.37.
Real rooms (crosstalk, distance, noise) will do worse. Mitigations: a USB conference mic, a second
enrollment sample (*Re-record voice* merges rather than replaces), the confirm_speaker learning
loop, and the host buttons.

With push-to-talk on, the room mic track is enabled only while the room or an in-room player holds
the floor, so the `/ws/audio` stream (and the ring) carries silence the rest of the time. Enrolling
from the table mic needs someone holding Space; enrolling from `/host` (its own mic stream) does not.

## Tuning

- `SPEAKER_THRESHOLD`: raise it (for example to 0.55) if the DM misattributes speakers; lower it if
  the DM asks too often.
- `minMargin` in `voiceprint.ts` (0.06) controls how the DM handles similar voices.
- `SPEECH_LEAD_MS` in `realtime/session.ts` (450) sets how much audio before `speech_started` is
  included.

## Tests

`apps/server/src/speaker/voiceprint.test.ts` covers cosine matching, ambiguity and threshold
handling, the running mean, ring-buffer slicing by timestamp, and silence trimming.
