# Bug: re-saved roster portraits stayed stale in browsers
Status: fixed (2026-10-20)
Area: server (roster), web (RosterPanel)

## Overview
`saveRosterPortrait` overwrote `<dataDir>/roster/assets/<rosterId>.png` in place and always
returned `/media/roster/<rosterId>.png`. The `/media` route sends
`cache-control: public, max-age=31536000, immutable` (safe for content-hashed campaign files), so a
browser that had loaded the old portrait kept showing it after "Update roster" or end_campaign.

## Repro
Mara with sprite bytes [1,1,1] -> saveToRoster; change sprite to [2,2,2] -> saveToRoster. The file
is [2,2,2] but `spriteUrl` is unchanged, so RosterPanel's `<img>` shows the cached old image.

## Root cause / Fix
A fixed URL for mutable content behind an immutable cache header. Fix in
`apps/server/src/game/roster.ts`: the URL is now `/media/roster/<rosterId>.png?v=<sha1[0..12]>` of
the file bytes, so each portrait version gets its own URL (the file name and path are unchanged;
the media route ignores the query). Test: roster.test.ts "the URL changes when the portrait bytes
change...".

## Notes
Old roster rows saved before the fix keep the unversioned URL until their next save; harmless.

## TODOs

## Completed
- [x] 2026-10-20: content-hash query on the roster portrait URL + regression test.
