---
title: Configuration (environment variables)
area: setup
topic: config
related_code:
  - apps/server/src/config.ts
  - .env.example
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version"
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
| `REALTIME_MODEL` | `gpt-realtime` | Voice DM model (e.g. a newer `gpt-realtime-*` when available) |
| `REALTIME_VOICE` | `cedar` | DM voice (Realtime voices such as `marin`, `cedar`, `ash`, `sage`…) |
| `TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | Transcribes player speech for the host log |
| `IMAGE_MODEL` | `gpt-image-1` | Maps and sprites |
| `IMAGE_QUALITY` | `medium` | `low` / `medium` / `high` (cost vs detail) |
| `SPEAKER_MODEL` | `models/wespeaker_en_voxceleb_resnet34.onnx` | sherpa-onnx speaker embedding model |
| `SPEAKER_THRESHOLD` | `0.45` | Minimum cosine score for a confident speaker match |
| `PORT` | `8787` | HTTP and WebSocket port (Vite's proxy uses it too) |
| `DATA_DIR` | `campaigns` | SQLite database and generated images |

Model names change often. Check the provider's model list and override these defaults instead of
editing code.
