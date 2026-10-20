---
title: Configuration (environment variables)
area: setup
topic: config
related_code:
  - apps/server/src/config.ts
  - .env.example
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-20: NPC_TTS defaults to on (0/false/no/off turn it off)"
  - "2026-10-20: BRAIN_TIMEOUT_MS covers Anthropic streams"
  - "2026-10-20: BRAIN_TIMEOUT_MS, BRAIN_REASONING_EFFORT, PREPAINT_MAPS"
  - "2026-10-19: PUBLIC_URL"
  - "2026-09-24: Added NPC_TTS and NPC_TTS_MODEL"
  - "2026-09-24: Initial version"
  - "2026-10-18: TURN_GATE and TURN_GATE_TIMEOUT_MS"
  - "2026-10-18: TURN_GATE accepted values, TURN_GATE_TIMEOUT_MS=0"
---

# Configuration

All settings are environment variables, read once in `apps/server/src/config.ts`. The server loads
`.env` from the repo root (`tsx --env-file-if-exists`). Relative paths are resolved from the repo
root.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Realtime voice and text DM, images, and the OpenAI brain |
| `BRAIN_PROVIDER` | `openai` | `openai` or `anthropic` |
| `BRAIN_MODEL_OPENAI` | `gpt-5` | Brain model when using OpenAI (Responses API) |
| `ANTHROPIC_API_KEY` | — | Needed when `BRAIN_PROVIDER=anthropic` |
| `BRAIN_MODEL_ANTHROPIC` | `claude-opus-5` | Brain model when using Anthropic (Messages API) |
| `BRAIN_TIMEOUT_MS` | `900000` | Per brain request (adventure, pregens, sheets, map reading); one retry. The SDK default would wait 10 min × 3. `0` = no limit (capped at setTimeout's ~24.8-day maximum). With Anthropic the whole streamed response must finish within it (`withDeadline`) |
| `BRAIN_REASONING_EFFORT` | unset | OpenAI reasoning effort for brain calls (`minimal`/`low`/`medium`/`high`); only for reasoning models (a non-reasoning model such as gpt-4o rejects it). Lower is faster |
| `REALTIME_MODEL` | `gpt-realtime` | Voice DM model (e.g. a newer `gpt-realtime-*` when available) |
| `REALTIME_VOICE` | `cedar` | DM voice (Realtime voices such as `marin`, `cedar`, `ash`, `sage`…) |
| `TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | Transcribes player speech for the host log |
| `TURN_GATE` | on | Noise-turn gate: hold the reply to a voice turn until its transcript arrives and skip turns that are only coughs or fillers. `off`, `false`, `0`, `no`, `disabled` or `none` (any case) answers on commit (lower latency); anything else is on |
| `TURN_GATE_TIMEOUT_MS` | `1200` | Gate timeout: answer anyway when no transcript arrived by then. `0` is allowed (answer as soon as the transcript or nothing arrives on the next tick), negatives become `0`, junk uses `1200`. Tune it from the `[turn-timing]` server log lines |
| `NPC_TTS` | on | The `speak_as_npc` tool: the DM voices every quoted NPC line in that NPC's own voice, played on `/table`. On when unset, empty or any other value; `0`/`false`/`no`/`off` turn it off. Needs `OPENAI_API_KEY` (`.env.example` sets `NPC_TTS=1`) |
| `NPC_TTS_MODEL` | `gpt-4o-mini-tts` | Speech model for `speak_as_npc` (must support `instructions`) |
| `IMAGE_MODEL` | `gpt-image-1` | Maps and sprites |
| `IMAGE_QUALITY` | `medium` | `low` / `medium` / `high` (cost vs detail) |
| `PREPAINT_MAPS` | on | When the party arrives somewhere, paint the next outline location's map in the background (one at a time) so the next arrival doesn't wait. Needs an image key; each prepaint also reads the map's features (a brain call). `0`/`false`/`off` disables (saves image and brain calls) |
| `SPEAKER_MODEL` | `models/wespeaker_en_voxceleb_resnet34.onnx` | sherpa-onnx speaker embedding model |
| `SPEAKER_THRESHOLD` | `0.45` | Minimum cosine score for a confident speaker match |
| `PORT` | `8787` | HTTP and WebSocket port (Vite's proxy uses it too) |
| `PUBLIC_URL` | empty | Base URL phones should open, e.g. `http://192.168.1.20:8787` (no `/player`). Used for the player link, the per-player QR codes on the host and the join QR on the TV. Empty = the laptop's first LAN IPv4 on `PORT` (pages opened over the LAN use their own address) |
| `DATA_DIR` | `campaigns` | SQLite database, generated images and NPC voice clips |

Model names change often. Check the provider's model list and override these defaults instead of
editing code.
