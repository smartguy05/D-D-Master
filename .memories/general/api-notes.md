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
- SDK v7 lists models such as gpt-realtime, gpt-realtime-1.5, gpt-realtime-2, gpt-realtime-2.1 and
  -mini. The default stays `gpt-realtime` (alias); override with REALTIME_MODEL.

## Anthropic
- No assistant prefill on current models (400). Use prompt instructions or structured outputs.
- Check `stop_reason === "refusal"` before reading content.
- Default brain model `claude-opus-5`; stream long outputs (`messages.stream().finalMessage()`).

## Images
- `images.generate({ model, prompt, size, quality, background:"transparent" })` → `b64_json`.

## sherpa-onnx-node 1.13
- `new SpeakerEmbeddingExtractor({model, numThreads})`; `createStream()`,
  `acceptWaveform({samples, sampleRate})`, `inputFinished()`, `compute(stream)`.
- `new LinearResampler(inRate, outRate)` takes positional args, not an object.
- Models: github.com/k2-fsa/sherpa-onnx/releases (speaker-recongition-models [sic], tts-models).
