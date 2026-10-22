# Bug: any web page could drive the local server (CSRF and DNS rebinding)
Status: fixed (2026-10-22)
Area: server (app.ts, auth/origin.ts)

## Overview
Before online-play phase 1 every route was open to anyone who could reach the port. Beyond the LAN,
a web page open in a browser on the server machine (or a LAN phone) could also drive it:
- **CSRF**: a cross-site `fetch` with a "simple" content type (`text/plain`, form posts) reaches
  `POST /api/dm/stop`, `/api/dm/stop-talking`, `/api/campaign/end-session`, `/api/history/undo`…
  without a CORS preflight. Fastify parses `text/plain` by default.
- **DNS rebinding**: a page on a public name that resolves to 127.0.0.1 is same-origin with the
  server from the browser's view, so it can read responses too.
- Adding a "this machine is the host" bypass for auth would have kept both holes open.

## Repro
From any site in a browser on the server machine:
`fetch("http://localhost:8787/api/dm/stop", {method: "POST", mode: "no-cors"})` reaches the route and stops the DM (found by review while adding auth; not reproduced live).

## Root cause / Fix
- No `Origin` check and no `Host` check. Fix:
  - `originAllowed` (auth/origin.ts): every non-GET request and every WebSocket upgrade with a
    browser `Origin` must name this server (`Host`, `X-Forwarded-Host` or `PUBLIC_URL`), else 403.
  - `classifyOrigin`: a local or LAN request whose `Host` is a public DNS name is treated as remote
    (no local bypass, no LAN trust).
  - The sign-in cookie is `SameSite=Lax`.

## Notes
- Tests: auth/origin.test.ts (rebinding, originAllowed), app.auth.test.ts ("refuses a cross-site
  POST even from this machine", `/ws` with a foreign Origin → 403).

## TODOs

## Completed
- 2026-10-22: Origin and Host checks with online-play phase 1.
