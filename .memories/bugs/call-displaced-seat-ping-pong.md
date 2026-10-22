# Bug: two devices on the same seat kicked each other out of the call forever
Status: fixed (2026-10-22)
Area: web

## Overview
A second page for the same seat replaces the first in the call. The displaced page kept its rejoin
effect, so its next `/ws` reconnect or prefs change took the seat back, and the two devices swapped
it forever.

## Root cause / Fix
useCall.ts rejoined whenever the mesh was ready and `/ws` connected. Fix: the relay now sends
`peers.refusedCode: "displaced"` (packages/shared/src/rtc.ts `RtcRefusedCode`, relay side by the
other agent). `displacedAfter` (call/callSteps.ts) latches it; `shouldJoin` blocks the rejoin while
displaced. VideoStrip shows **Use this device** (`call.takeSeat`), which clears the flag and joins.
Tests: call/callSteps.test.ts.

## Notes
Found in the Phase C review of PR #1.

## TODOs

## Completed
- 2026-10-22: Fixed.
