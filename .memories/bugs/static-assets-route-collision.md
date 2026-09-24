# Bug: Host page blank after rebuild (static route / assets collision)
Status: fixed (2026-09-24)
Area: server

## Overview
After `pnpm build` while the server was running, `/host` loaded index.html, but the JS bundle
request returned HTML ("Expected a JavaScript module script but the server responded with a MIME
type of text/html").

## Repro
Start the server, rebuild the web app (new hashed filenames), then reload /host.

## Root cause / Fix
- `@fastify/static` with `wildcard: false` registers one route per file that exists at startup, so
  new hashed bundles fell through to the SPA fallback. Fix: `wildcard: true`.
- Campaign images were served under `/assets/:campaignId/:file`, the same prefix as Vite's build
  output (`/assets/index-*.js`), which made this confusing. Fix: images moved to `/media/...`
  (`ASSET_URL_PREFIX`), and the Vite proxy was updated.

## Completed
- 2026-09-24: Both fixes. Verified with Playwright screenshots of /host and /table.
