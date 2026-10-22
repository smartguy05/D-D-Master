# External API notes

## OpenAI Realtime (GA), verified against the openai npm SDK v7.23 types
- WebRTC call: `client.realtime.calls.create({ sdp, session })`, a multipart POST to
  `/v1/realtime/calls`. The body is the SDP answer; `Location: /v1/realtime/calls/<call_id>`.
- Sideband: `wss://api.openai.com/v1/realtime?call_id=<id>` with Bearer auth.
- Session shape: `{ type:"realtime", instructions, output_modalities, tools, tool_choice,
  audio:{ input:{ transcription, noise_reduction, turn_detection }, output:{ voice } } }`.
- turn_detection `semantic_vad` supports `create_response`, `interrupt_response`, `eagerness`.
- Events used: input_audio_buffer.{speech_started,speech_stopped,committed},
  conversation.item.input_audio_transcription.completed, response.{created,done},
  response.output_audio_transcript.done, response.output_text.done,
  output_audio_buffer.{started,stopped,cleared}, error.
- `conversation.item.input_audio_transcription.failed`: `{ item_id, content_index, error: { code?,
  message?, param?, type? } }`. Client `conversation.item.delete`: `{ type, item_id }` (server
  answers `conversation.item.deleted`). Client items may carry their own `id` (we set one on
  speaker notes so a noise turn can delete its note). `speech_started.audio_start_ms` /
  `speech_stopped.audio_end_ms` are offsets into the input audio stream (incl. prefix padding).
  (SDK v7.23 types, 2026-10-18.)
- SDK v7 lists models such as gpt-realtime, gpt-realtime-1.5, gpt-realtime-2, gpt-realtime-2.1 and
  -mini. The default stays `gpt-realtime` (alias); override with REALTIME_MODEL.

- The Realtime output `voice` cannot be changed once the session has produced audio, so per-NPC
  voices mid-session are not possible. Use performance directions or a separate TTS clip.
- Speech (TTS): `client.audio.speech.create({ model, voice, input, instructions?, response_format })`
  returns a fetch Response (`arrayBuffer()`). `instructions` does not work with tts-1/tts-1-hd.
  Voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar (SDK v7.23 types).
- The openai SDK defaults to `timeout` 10 min and `maxRetries` 2, so one stalled call can hang ~30 min.
  Always pass both (createNpcVoice, brainClientOptions). Per-request `{ signal }` aborts the call
  (bugs/ai-player-goes-mute.md, 2026-10-21).

## Anthropic
- No assistant prefill on current models (400). Use prompt instructions or structured outputs.
- Check `stop_reason === "refusal"` before reading content.
- Default brain model `claude-opus-5`; stream long outputs (`messages.stream().finalMessage()`).

## Images
- `images.generate({ model, prompt, size, quality, background:"transparent" })` → `b64_json`.
- A safety refusal is a 400 with code `moderation_blocked` (older: `content_policy_violation`) and a
  "safety system" message. Retrying the same prompt never helps. Reword it (`isModerationError`,
  bugs/sprite-moderation-blocked.md). Hooded white sheets with eye holes get refused.

## sherpa-onnx-node 1.13
- `new SpeakerEmbeddingExtractor({model, numThreads})`; `createStream()`,
  `acceptWaveform({samples, sampleRate})`, `inputFinished()`, `compute(stream)`.
- `new LinearResampler(inRate, outRate)` takes positional args, not an object.
- Models: github.com/k2-fsa/sherpa-onnx/releases (speaker-recongition-models [sic], tts-models).
- Realtime `output_audio_buffer.clear` is WebRTC-only and should follow `response.cancel`; the server
  then emits `output_audio_buffer.cleared`. Used by the host Stop talking button (2026-10-18).
