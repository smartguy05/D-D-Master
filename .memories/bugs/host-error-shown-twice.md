# Bug: one failure shows two error boxes on /host, one of them never goes away
Status: fixed (2026-10-23)
Area: web (host notices)

## Overview
A failed map paint showed a red-bordered ⚠️ job chip in the bottom-left corner that could never be dismissed, plus a
shorter red notice in the bottom-right corner that disappeared after 8 s. The error showed twice, the copy that lasted couldn't be
dismissed, and the one that could be read in full vanished on its own.

## Repro
Paint a map with a bad `IMAGE_MODEL` (Adventure tab → Paint map).

## Root cause / Fix
- `useServer` kept `job` events with `status: "error"` forever (only `done` was removed after 3 s), and
  `HostPage.run()` showed the same HTTP rejection as an 8 s notice. Server `error` events used the same 8 s timer.
- Fix: new `apps/web/src/lib/notices.ts` (`addNotice` merges a repeated message, keeping the more severe
  level and filling in the title; `expireNotice` never removes errors; `autoDismissMs`). `useServer` keeps
  `notices` (no more `errors`), turns failed jobs into error notices titled with the job label and drops
  their chip, and exports `pushNotice` / `dismissNotice`. `HostPage` renders a single bottom-right stack
  with an icon, title, message and ✕. `error` events carry an optional `level`. Realtime
  `onError(message, "warning")` is used for "reconnecting…".
- Tests: `lib/notices.test.ts`; `realtime/session.test.ts` (reconnecting is a warning, gave up is an error).
- Checked in the isolated app: one card that stays more than 10 s, ✕ removes it, no chip on the left.

## Notes
- PlayTab's inline `.notice` alerts are unchanged (the new styles are scoped to `.notices .notice`).

## TODOs

## Completed
- 2026-10-23: unified notice stack shipped.
