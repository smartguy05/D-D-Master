---
title: Install and run
area: setup
topic: install
related_code:
  - package.json
  - apps/server/package.json
  - apps/web/package.json
  - apps/web/vite.config.ts
  - scripts/download-models.sh
  - .env.example
created: 2026-09-24
last_updated: 2026-10-20
last_audited: 2026-10-20
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-09-24: Initial version"
  - "2026-10-20: Player phones (/player, QR codes, PUBLIC_URL); troubleshooting for brain timeouts and phone links"
---

# Install and run

## Requirements

- Node.js 22+ and pnpm 10 (`corepack enable`).
- A recent Chrome or Edge on the host laptop (WebRTC, AudioWorklet and WebGL) and on the TV
  (WebGL).
- Python 3.10+ for the docs tooling only.
- An OpenAI API key for voice, text DM, images and the default brain. An Anthropic key is optional.

## Setup

```bash
pnpm install
cp .env.example .env              # add OPENAI_API_KEY (and optionally ANTHROPIC_API_KEY)
bash scripts/download-models.sh   # speaker-ID model (~26 MB) into ./models
```

## Run (production style, one port)

```bash
pnpm build        # builds apps/web/dist
pnpm start        # server on http://0.0.0.0:8787, serving the UI too
```

- On the laptop, open `http://localhost:8787/host`. Microphone access requires `localhost` or HTTPS.
- On the TV, open `http://<laptop-lan-ip>:8787/table`.
- On phones, open `http://<laptop-lan-ip>:8787/player` (or scan a join QR code: per player on
  `/host`, or press `Q` on the TV). If the LAN IP is wrong (VPN, several adapters), set `PUBLIC_URL`.

## Run (development, hot reload)

```bash
pnpm dev          # server (tsx watch) + Vite on http://localhost:5173
```

Vite proxies `/api`, `/ws` and `/media` to the server (`PORT`, default 8787).

## Try it without keys

```bash
pnpm --filter @dm/server seed:demo && pnpm start
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "voice ID" pill is red | Run `bash scripts/download-models.sh`. `sherpa-onnx-node` ships prebuilt binaries for Linux, macOS and Windows x64/arm64 |
| Mic permission never prompts | Use `localhost` or HTTPS on the host machine |
| TV is blank or black | Check that WebGL is enabled in the TV browser, or use a laptop or stick PC with Chrome |
| DM mixes up speakers | Re-record voices closer to the mic, raise `SPEAKER_THRESHOLD`, or use the host buttons |
| `OPENAI_API_KEY is not set` | Add it to `.env` in the repo root and restart |
| Phones can't open the join link or QR code | Set `PUBLIC_URL` (e.g. `http://192.168.1.20:8787`) and check the phone is on the same network |
| A brain job (adventure, pregens) times out | Raise `BRAIN_TIMEOUT_MS` (0 = no limit) or set `BRAIN_REASONING_EFFORT=low` (OpenAI) |
