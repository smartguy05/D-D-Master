# Bug: the DM can stop mid tool chain on a player's turn and nothing recovers it
Status: open
Area: server (realtime session)

## Overview
Text mode: Quill cast Magic Missile at 2nd level. The DM rolled darts 1–3, applied two, then the
reply ended: dart 3 unapplied, no dart 4, no `next_turn`, no speech. Status "listening"; nothing
happened for over 2 minutes until a host whisper.

## Repro
Test run 2026-10-19, events 586–591, then silence until the whisper (592+).

## Root cause / Fix
`nudgeStalledTurn` (see `dm-stalls-on-monster-turn.md`) only covers DM-played (monster/NPC) turns
and only after a speech-only reply. Here the last response after tool outputs completed with no
output on a PC's turn. Idea: after a tool-output follow-up response completes with no text and no
calls, prompt once ("finish resolving the last action, then speak").

## TODOs
- [ ] Empty-follow-up nudge + session test
## Completed
