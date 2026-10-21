# Bug: TV plays no NPC voices until someone clicks it, with no hint
Status: fixed (2026-10-21)
Area: web

## Overview
A freshly opened `/table` is blocked by the browser autoplay policy. NPC clips (`speak_as_npc`)
failed with `NotAllowedError`, were counted as ended (so the DM carried on) and nobody heard them;
dice and effect sounds were silent too. The 🔊 badge was display-only, so the table looked fine.

## Repro
1. Open `/table` on the TV and don't touch it.
2. Start the voice DM and have it voice an NPC.
3. The subtitle shows, no sound plays.

## Root cause / Fix
`unlockAudio()` only resumed the dice AudioContext on the first key/click, and nothing told the
viewer that a click was needed; HTMLAudioElement playback was never primed. Fix:
- `lib/audioUnlock.ts` `AudioUnlock`: unlocks only when both the context runs and a 10 ms silent
  WAV plays inside the gesture; a step that never settles gives up after 1.5 s.
- `npcAudio.ts`: a `NotAllowedError` calls `onBlocked` (→ `markAudioLocked`) and still reports the
  clip as ended.
- `TablePage.tsx`: a "🔊 Click to enable sound" overlay while locked (and not muted); the mute
  badge is a button that toggles mute.

## Notes
On load the page tries once without a gesture, so kiosk browsers with
`--autoplay-policy=no-user-gesture-required` never see the overlay. A clip refused before the
click is not replayed.

## TODOs
- [ ] Live-check on the real TV browser.

## Completed
- 2026-10-21: overlay, clickable badge, audioUnlock.test.ts and the npcAudio NotAllowedError test.
