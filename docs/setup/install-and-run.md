---
title: Install and run
area: setup
topic: install
related_code:
  - package.json
  - apps/server/package.json
  - apps/server/src/tls.ts
  - apps/server/src/tls.test.ts
  - apps/web/package.json
  - apps/web/vite.config.ts
  - scripts/download-models.sh
  - .env.example
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Desktop server + laptop host needs HOST_PASSWORD (the LAN is table access); link to online play"
  - "2026-10-21: Troubleshooting: unreachable server, stale tsx watch, EADDRINUSE after timeout, pkill self-kill, second server next to pnpm dev"
  - "2026-10-21: Both /host and /table on the laptop; the mic prompt comes in the table tab (it carries the call)"
  - "2026-09-24: Initial version"
  - "2026-10-21: HTTPS listener on 8443 (self-signed or HTTPS_CERT/HTTPS_KEY); Desktop server + laptop table section"
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
pnpm start        # server on http://0.0.0.0:8787 and https://0.0.0.0:8443, serving the UI too
```

The startup log prints both URLs and, the first time, where it made the self-signed certificate.

- On the laptop, open `http://localhost:8787/host` and `http://localhost:8787/table` (on the TV,
  as the laptop's second screen). Microphone access requires `localhost` or HTTPS. The table
  screen runs the voice DM's mic and audio, so it belongs on the machine with the table mic;
  `/host` is controls only.
- On phones, open `http://<laptop-lan-ip>:8787/player` (or scan a join QR code: per player on
  `/host`, or press `Q` on the TV). If the LAN IP is wrong (VPN, several adapters), set `PUBLIC_URL`.

## Desktop server + laptop table

Run the server on a desktop and use a laptop (plugged into the TV, with the table mic) as the host
controls and the TV. Browsers only allow the microphone on `https` or `localhost`, so the laptop
uses the HTTPS listener (`HTTPS_PORT`, default 8443):

1. On the desktop, set `HOST_PASSWORD` in `.env`: the home network gets table access (TV, phones)
   but not host access ([authentication](../server/auth.md)). Then `pnpm build && pnpm start`. The
   log shows a line like
   `Laptop host/TV (accept the certificate once): https://192.168.1.20:8443/host`.
2. On the laptop, open `https://<desktop-ip>:8443/host`. The browser warns about the self-signed
   certificate: choose Advanced → Proceed once. Sign in with the host password at `/login` (once;
   the cookie lasts 30 days). Then open `https://<desktop-ip>:8443/table` (on the
   TV screen) the same way.
3. Press **Start voice DM** on `/host` and allow the mic in the **table** tab when the browser
   asks (the table screen carries the call). The enrollment mic on `/host`'s Party tab asks once
   too.
4. Phones keep joining over plain HTTP, `http://<desktop-ip>:8787/player` (the join QR codes use
   it), so there is no warning on each phone.

The self-signed certificate lives in `DATA_DIR/certs/` and covers `localhost`, `127.0.0.1` and every
LAN IPv4 address of the desktop. It is remade (another one-time warning) when the desktop gets a
new LAN address. To avoid the warning, make a trusted certificate with
[mkcert](https://github.com/FiloSottile/mkcert) (`mkcert -install` on the laptop with the desktop's
root CA, `mkcert <desktop-ip> localhost` on the desktop) and set `HTTPS_CERT` and `HTTPS_KEY` to
the two files. `HTTPS_PORT=0` turns the HTTPS listener off.

For players joining over the internet, see [online play](online-play.md).

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
| Mic permission never prompts | Use `localhost`, or `https://<server-ip>:8443/host` from another machine |
| Browser refuses `https://…:8443` | Accept the self-signed certificate once (Advanced → Proceed); after a LAN address change it is remade, accept it again. Check the log for "HTTPS listener … is off" |
| TV is blank or black | Check that WebGL is enabled in the TV browser, or use a laptop or stick PC with Chrome |
| DM mixes up speakers | Re-record voices closer to the mic, raise `SPEAKER_THRESHOLD`, or use the host buttons |
| `OPENAI_API_KEY is not set` | Add it to `.env` in the repo root and restart |
| Phones can't open the join link or QR code | Set `PUBLIC_URL` (e.g. `http://192.168.1.20:8787`) and check the phone is on the same network |
| A brain job (adventure, pregens) times out | Raise `BRAIN_TIMEOUT_MS` (0 = no limit) or set `BRAIN_REASONING_EFFORT=low` (OpenAI) |
| Host shows "Can't reach the game server. Is it running?" (was "Failed to fetch") | The server isn't running and the open tab is left over from an earlier session. Run `pnpm dev` and reload |
| Code edits don't take effect under `pnpm dev` | `tsx watch` can stop restarting the server while still printing old "server on" lines. Check `ss -ltnp \| grep 8787` and `ps -o pid,lstart -p <pid>`; if the start time is old, restart `pnpm dev` |
| `EADDRINUSE` on start | A `timeout N pnpm start` wrapper kills pnpm but can leave the `tsx` child on the port. Find it with `ss -ltnp` and kill that pid |
| A second server next to `pnpm dev` fails | `pnpm dev` holds 8787 **and** 8443. Start the other one with different `PORT` and `HTTPS_PORT` (and its own `DATA_DIR`) |
| The shell dies when stopping the server | `pkill -f src/index.ts` also matches the shell whose command line contains that string. Use `ps aux \| grep [s]rc/index.ts` and kill the pid |
