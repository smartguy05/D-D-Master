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
- Since 2026-10-21 two pages can stream: `/table` (`?role=table`, the play-time mic that carries
  the call) and `/host` (`?role=host`, enrollment only). Only one feeds the ring, since interleaved
  chunks garble embeddings: `pickAudioSource` takes host while `SpeakerService.enrolling` (cap 120 s)
  and the host streams, else table, else host. Host pill "Voice ID offline" when a voice DM is live
  and no table mic stream exists (bugs/closing-host-kills-dm.md).
- Voice ID test (2026-10-22, user request): Party tab *Test voice ID* → someone talks → *Done*
  shows the best match (confident or "not sure") and every player's score. Decisions with the user:
  one Start/Done control for the party, name + scores, **read-only** (never changes a voiceprint;
  re-record instead), and the DM ignores the words. It reuses the enrollment recording path
  (`SpeakerService.recording` kind `test`, same `enrolling` flag and `enrollTimer`), so the host mic
  wins and /table keeps the room mic open.
- `DmHost.inVoiceRecording` (`SpeakerService.inRecording`) drops DM turns said during, or just
  after, any recording; before it, enrollment words reached the DM with push-to-talk off
  (bugs/enrollment-speech-reaches-dm.md).
- Synthetic eval (VCTK TTS, 6 voices, 1 enrollment sentence each): 30/30 correct on 2026-09-24.
  Real rooms will be harder.

## TODOs
- [ ] Live-check enrollment on `/host` while `/table` also streams the same room (the host stream
      must win for the whole recording) (see general/live-test-checklist.md)
- [ ] Measure with real people and a real room mic; tune the threshold and margin (see general/live-test-checklist.md)
- [ ] Live-check the voice ID test with real people: correct name and sensible scores, and the DM
      says nothing about "testing, testing" (see general/live-test-checklist.md)
- [ ] Handle overlapping speakers (split one turn into several speaker segments with diarization)
- [ ] Enrollment quality meter (warn if the sample is too short or too noisy)

## Completed
- 2026-10-22: Voice ID test on the Party tab (`/api/voice-test/start|stop`, `voice_test` event,
  `scoreSpeakers`, `VoiceTest` component), and the DM ignores words said while a voice is recorded.
- 2026-10-21: Audio source per role (`/ws/audio?role`, `pickAudioSource`, `SpeakerService.enrolling`).
- 2026-10-20: Voiceprints carry over between campaigns through the character roster: saved to
  `roster_voiceprints` on save, copied into `voiceprints` on join (unless the player already has one).
- 2026-10-19: Live who's talking: `speaker/live.ts` LiveTalk (mic level ~8/s and a provisional
  voice-ID match after 1.2 s of speech, from speech_started to speech_stopped), `talk` event, TV
  party card pulse + level bar + live speaker tag (`web/src/lib/talk.ts`). Needs a live check
  of CPU cost and how often the provisional match disagrees with the final one.
- 2026-10-18: First real-voice check: 2 people enrolled and recognized correctly in live voice play
  (default threshold). Still to do: a full table (3-4 voices) in a real room.
- 2026-09-24: Enrollment, identification, confirm_speaker learning, host override, eval script,
  unit tests.
