# Feature: 3D physics dice
Status: done (vertical slice)
Docs: docs/web/dice-3d.md, docs/gameplay/dice-modes.md

## Overview
Real 3D dice (d4, d6, d8, d10, d12, d20, d100 as percentile + d10) thrown with cannon-es on the TV.
The server rolls first (crypto RNG). The client simulates offline, finds the landed face, and swaps
face labels so the landed face shows the server's value. Then it replays the recorded frames.

## Notes
- The d10 is a hand-built pentagonal trapezohedron (planar kites, tested).
- The d4 uses vertex numbering (three numbers per face); the result is the top vertex.
- Rolls queue on the table so attack and damage animate in order.
- Physical-dice players: no animation, just a toast marked "physical dice".
- Audio needs a user gesture before it starts in browsers; kiosk TVs can use Chromium
  `--autoplay-policy=no-user-gesture-required`.

## TODOs
- [ ] Rounded-edge geometry / normal maps for extra realism
- [ ] Per-player dice skins (materials, metallic, gem)
- [ ] Let players "throw" from a phone (swipe → impulse), still server-authoritative

## Completed
- 2026-09-24: Dice sounds: collisions recorded in simulate.ts (velocity change beyond gravity, per-die
  3-frame gap, die vs table surface), merged by `impactSchedule`, synthesized with WebAudio noise
  bursts during playback; M mutes (localStorage `dm.table.muted`).
- 2026-09-24: All die types, label forcing, tray overlay, toast, and tests that every value lands on
  top.
