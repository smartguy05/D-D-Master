---
name: run-and-screenshot
description: Launch an isolated copy of this app (demo campaign, spare ports, scratch data dir) and screenshot /host, /table and /player to confirm a change in the real UI. Use when asked to run/start/screenshot the app or visually verify a web change, without touching the user's own dev server or campaigns.
---

# Run an isolated server and take screenshots

The user usually has `pnpm dev` running: the server on :8787 (HTTP) and :8443 (HTTPS), and Vite on :5173. **Never
stop it and never use its data dir.** Run a second copy on other ports with a scratch `DATA_DIR`.

## Launch
```bash
SCRATCH=<scratchpad>/dm-data
DATA_DIR=$SCRATCH pnpm --filter @dm/server seed:demo     # demo campaign, no API keys needed
pnpm build                                               # apps/web/dist, served by the server
PORT=8791 HTTPS_PORT=8451 DATA_DIR=$SCRATCH pnpm start   # run with run_in_background
curl -s localhost:8791/api/campaigns | head              # wait until it answers
```
For hot reload instead of a build, follow `marketing/demo-video/capture/README.md`: run the server with
`npx tsx` on a spare `PORT`, and Vite with `PORT=<server> npx vite --port 5180 --strictPort`.

Drive the game without voice: `POST /api/tools/<name>` with a JSON body, and the server runs it as a host
call. See `docs/server/http-api.md`.

## Screenshots
Use the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`). Viewports:
- `/table` (TV) and `/host`: 1600×900.
- `/player/<characterId>` (phone): 390×844.

Take shots about 150–400 ms after an action when checking animation order. WebGL in headless Chromium runs on
SwiftShader, so the frame rate is low: judge what appears and in what order, not exact timing. Google Fonts may fail
to load there, which is harmless.

## Stop and clean up
- Kill only your own server: `ss -ltnp | grep 8791` to get the pid, then `kill <pid>`.
- **Don't** `pkill -f src/index.ts`. It matches your own shell's command line and kills it.
- `timeout N pnpm start` can leave the `tsx` child holding the port, which causes EADDRINUSE on the next start.
  Check with `ss`.

## When the user's dev server misbehaves
- `tsx watch` can silently stop restarting. Compare `ps -o pid,lstart` of the :8787 process with your
  edit time, and tell the user to restart `pnpm dev`.
- "Failed to fetch" in the host UI almost always means the server is down.
