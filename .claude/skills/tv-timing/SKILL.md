---
name: tv-timing
description: Rules and steps for anything the TV (/table) shows in response to game events — moments (victory, death, turn banner, attitude…), attack/spell effects, HP bars, token falls, turn marker — and how it must wait for the 3D dice. Use when adding a moment kind or effect, or fixing "the TV showed X before the dice landed" / leaked a hidden monster / drew under the fog.
---

# TV timing, moments and effects

## The core rule
The server broadcasts the new state together with `roll`, `effect` and `moment` events in the same instant. The dice
tray then plays for several seconds. **Anything derived from state that the table should see after the
roll must be held explicitly.** About eight bugs came from this: `attack-anim-before-damage-dice`,
`hp-and-removal-before-dice`, `token-falls-before-death-moment`, `turn-marker-before-dice`,
`dice-playback-clock-cap` (all in `.memories/bugs/`).

Pure, tested planners in `apps/web/src/table/` (use them, don't add timers to components):
- `boardHold.ts`: `holdBoard` / `displayState` keep the board (HP, removals) at the pre-roll state.
- `effectPlan.ts`: `releaseHeld` (with `DAMAGE_GRACE_MS`) releases effects after the dice, and
  `travelSuppressed` dedupes source→target travel.
- `momentPlan.ts`: `MOMENT_MS`, `heldStanding` / `tokenFallen` and `shownTurn`.
- Every hold is capped by `HOLD_CAP_MS`, so a stuck tray never freezes the board.
- `TableScene.tsx` (`useTableScene`, rendered by the TV's `TablePage` and the remote `/play` page) syncs these on a
  state change, on a dice change and on a 200 ms tick. `onRoll` must mark the tray busy in the same tick. A player's
  projected state marks a hidden creature's turn with `turnIndex: -1`; `liveTurnId` turns it into `HIDDEN_TURN`.

## Adding a moment kind
1. Add `MomentKind` to `packages/shared/src/schemas.ts`, with a test in `schemas.moments.test.ts`.
2. Build moments only through `moment()` in `apps/server/src/engine/moments.ts`, pushed to
   `outcome.moments`. Moments are broadcast only: never stored or snapshotted.
3. If the moment targets a creature, add the kind to the hand-kept list in
   `momentForTable` (`packages/shared/src/visibility.ts`; `apps/web/src/table/visibility.ts` re-exports
   it). Otherwise it leaks hidden or fogged monsters (`attitude-moment-leaks-hidden-monster.md`), on
   the TV and to player sockets, which the server filters with the same function
   (`docs/server/state-projection.md`).
4. In `momentPlan.ts`, set the variant, duration and pose. Add the overlay in `MomentOverlay.tsx` and the sound in
   `apps/web/src/dice/sound.ts`. The sound plays when the overlay becomes current, not when the moment arrives.
5. Test the planner in `momentPlan.test.ts` / `effectPlan.test.ts` / `boardHold.test.ts`.

## Rendering traps (R3F / three.js)
- Anything drawn above the fog needs a transparent material. Opaque meshes end up under the fog layer
  (`renderOrder -1`, `fog-hides-effects.md`).
- Going from no texture to a texture needs a `key` remount or `needsUpdate` (`painted-map-white-board.md`).
- Keep frame-loop math in pure helpers. `Math.sin(Infinity)` produced a NaN matrix that hid every
  standee (`standees-hidden-nan-pose.md`; see `reactionPose` in `effectPlan.ts`).
- Billboards face the camera fully. `lockX`/`lockZ` made them look squashed.

## Checking it
Unit tests first. For a visual check use the `run-and-screenshot` skill: call the tool with
`POST /api/tools/<name>`, then take `/table` shots at about 150 ms and 400 ms. Headless SwiftShader runs at a low
frame rate, so judge order, not exact timing. Exact timing needs a live check on the real TV.
Docs: `docs/web/table-display.md`, `docs/gameplay/moments.md`.
