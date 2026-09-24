---
title: Speaker identification (voiceprints)
area: server
topic: speaker-id
related_code:
  - apps/server/src/speaker/**
  - apps/server/src/scripts/eval-voiceid.ts
  - scripts/download-models.sh
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version; 30/30 on synthetic 6-speaker eval"
---

# Speaker identification (voiceprints)

**Goal:** players say their name **once**. After that, the DM knows who is talking from a single
shared table mic.

## Pipeline

1. **Capture.** The `/host` page streams the table mic to `/ws/audio`. An AudioWorklet downsamples
   it to 16 kHz mono PCM16 in 100 ms chunks. The server writes it into `AudioRing`, a 90-second
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

- A host tap on a **Who's speaking?** button applies to the next turn that ends within 20 s.
- If only one player has a character, voice ID is skipped.
- With no voiceprints, or no model, the DM gets `[speaker: unknown …]` and asks when it matters.

## Measured accuracy

`pnpm --filter @dm/server eval:voiceid` (after `bash scripts/download-models.sh --with-tts`)
enrolls 6 synthetic VCTK voices from **one sentence each**, then identifies 5 new sentences per
voice through the real ring → trim → embed → match path.
Result on 2026-09-24: **30/30 correct, all confident**, with scores 0.70–0.93 and margins 0.13–0.37.
Real rooms (crosstalk, distance, noise) will do worse. Mitigations: a USB conference mic, a second
enrollment sample (*Re-record voice* merges rather than replaces), the confirm_speaker learning
loop, and the host buttons.

## Tuning

- `SPEAKER_THRESHOLD`: raise it (for example to 0.55) if the DM misattributes speakers; lower it if
  the DM asks too often.
- `minMargin` in `voiceprint.ts` (0.06) controls how the DM handles similar voices.
- `SPEECH_LEAD_MS` in `realtime/session.ts` (450) sets how much audio before `speech_started` is
  included.

## Tests

`apps/server/src/speaker/voiceprint.test.ts` covers cosine matching, ambiguity and threshold
handling, the running mean, ring-buffer slicing by timestamp, and silence trimming.
