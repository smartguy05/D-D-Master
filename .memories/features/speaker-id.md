# Feature: Speaker identification (say your name once)
Status: done (vertical slice)
Docs: docs/server/speaker-id.md

## Overview
One shared mic. Each player records a voice sample once (name + a sentence). sherpa-onnx speaker
embeddings (WeSpeaker ResNet34, 256-dim) and cosine matching identify the speaker of every voice
turn. The DM gets a `[speaker: Sam as Thorin, confidence 0.83]` note before responding.

## Notes
- The user explicitly asked that players only have to say their name once. Voiceprints persist per
  campaign in SQLite.
- Confidence requires score ≥ SPEAKER_THRESHOLD (0.45) and a margin of ≥ 0.06 over the runner-up.
- Low confidence → the DM asks → `confirm_speaker` → that sample is merged into the voiceprint.
- A host tap overrides the next turn (within 20 s). With a single player, voice ID is skipped.
- Audio: AudioWorklet → 16 kHz PCM16 → /ws/audio → AudioRing (90 s, wall-clock stamped).
- Synthetic eval (VCTK TTS, 6 voices, 1 enrollment sentence each): 30/30 correct on 2026-09-24.
  Real rooms will be harder.

## TODOs
- [ ] Measure with real people and a real room mic; tune the threshold and margin
- [ ] Handle overlapping speakers (split one turn into several speaker segments with diarization)
- [ ] Show live "who's talking" on the table before the DM responds (VAD + streaming embedding)
- [ ] Enrollment quality meter (warn if the sample is too short or too noisy)

## Completed
- 2026-09-24: Enrollment, identification, confirm_speaker learning, host override, eval script,
  unit tests.
