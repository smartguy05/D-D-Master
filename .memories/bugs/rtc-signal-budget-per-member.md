# Bug: the room's ICE burst for a full call could exceed the per-member signal budget
Status: fixed (2026-10-22)
Area: server

## Overview
`RTC_RATE_MAX` (120 signals / 10 s) was counted per sender. The room opens all 5 links at once,
each with an SDP and ~20-25 ICE candidates (separate audio/video transports, host/srflx/relay).
Over the budget the relay dropped signals silently, and the last ones are the TURN relay
candidates that two NATed homes need.

## Repro
5 remote players + room, 27 signals per link -> only 120 of 135 relayed.

## Root cause / Fix
The budget is now per link (sender, target peer id): each member keeps a `Map<target, count>` per
window. Test "the signal budget is per link" in `rtcRelay.test.ts`.

## Notes
- The headless e2e ran without STUN/TURN (host candidates only), so it could not show this.

## TODOs

## Completed
- 2026-10-22: Per-link budget with test.
