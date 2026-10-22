# Bug: switching from the Chat tab crashed the phone page
Status: fixed (2026-10-22)
Area: web (player/creation/ChatTab.tsx)

## Overview
On /player, tapping Build after the Chat tab blanked the page with "TypeError: y is not a function"
(React, effect cleanup).

## Repro
Headless Chromium (Playwright), /player/<id> without a character: Chat tab, then tap Build.

## Root cause / Fix
- `useEffect(() => end.current?.scrollIntoView({ block: "end" }), …)` returned scrollIntoView's
  value. In newer Chromium that is a **Promise**, so React treated it as the cleanup and called it
  on unmount.
- Fix: a braced effect body that returns nothing. The other effects with an arrow-expression body
  return an unsubscribe function, which is fine. A grep found no other `scrollIntoView` effect.

## Notes
- Recorded as a gotcha in docs/gameplay/phone-creation.md. Any DOM call whose return type may
  change (scroll, focus, animations) belongs in a braced effect.

## TODOs
## Completed
- 2026-10-22: Fixed, and checked visually (Chat → Build → Join).
