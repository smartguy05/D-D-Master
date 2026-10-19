# Bug: "Failed to fetch" when creating a campaign
Status: fixed (2026-10-18)
Area: web (host Adventure tab)

## Overview
Clicking *Create* under *New campaign* showed the notice `Failed to fetch`, and no campaign appeared.

## Repro
Open /host, stop the server (or let a dev session from an earlier run die), then click *Create*.

## Root cause / Fix
There was no code bug. The dev server (:8787 and Vite :5173) was not running, and the open /host
tab was a leftover page. `fetch` rejects with a `TypeError("Failed to fetch")` when no response
arrives, and `api.ts` passed that message through, which didn't point at the cause.
Fix: `apps/web/src/lib/api.ts` catches the rejection and throws "Can't reach the game server. Is it
running? (pnpm dev)". Tested in `api.test.ts`.

## Notes
If you see that message, run `pnpm dev` and reload the page.

## TODOs

## Completed
- 2026-10-18: Clearer unreachable-server error in api.ts; restarted pnpm dev.
