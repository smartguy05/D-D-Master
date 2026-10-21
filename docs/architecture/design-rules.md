---
title: Design rules (invariants learned from bugs)
area: architecture
topic: design-rules
related_code:
  - apps/server/src/game/service.ts
  - apps/server/src/engine/tools.ts
  - apps/server/src/engine/economy.ts
  - apps/server/src/realtime/session.ts
  - apps/server/src/brain/provider.ts
  - apps/web/src/table/momentPlan.ts
  - apps/web/src/table/boardHold.ts
  - apps/web/src/table/effectPlan.ts
  - apps/web/src/table/visibility.ts
created: 2026-10-21
last_updated: 2026-10-21
last_audited: 2026-10-21
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-21: Initial version, distilled from the 105 bug memories in .memories/bugs/"
---

# Design rules

Most bugs fixed so far belong to a handful of classes, and each class already has a fix pattern.
Read the rule for an area before changing it. Every rule lists the bugs behind it (files in
`.memories/bugs/`) and the code that implements it.

## 1. The TV never runs ahead of the dice

**Rule.** Every change the TV derives from game state must wait until the dice tray finishes the
roll that caused it. That covers HP bars, removed tokens, the turn marker, a fallen token,
attack travel and moments. The server sends state, effects and moments all at once, but the
tray plays them over several seconds.

**How.** Add a hold to a pure planner that has its own tests. Never add a timer to a component.
- `table/boardHold.ts`: `holdBoard` and `displayState` handle HP and removed creatures, with
  `HOLD_CAP_MS` as the cap.
- `table/effectPlan.ts`: `releaseHeld` handles effects, with `DAMAGE_GRACE_MS` as the grace period.
- `table/momentPlan.ts`: `releaseHeldMoments`, `shownTurn` (the turn marker) and `heldStanding` /
  `tokenFallen` (keep a dying token standing).
- `onRoll` marks the tray busy in the same tick the roll arrives.

**Bugs.** attack-anim-before-damage-dice, hp-and-removal-before-dice, turn-marker-before-dice,
token-falls-before-death-moment, dice-playback-clock-cap, animation-review-round1.
See [table display](../web/table-display.md) and [moments](../gameplay/moments.md).

## 2. The engine enforces the rules; the persona only guides

**Rule.** The voice model will skip "setup" tool calls and will narrate things the engine never
allowed. A persona line on its own does not fix that. Use three layers, in this order:
1. **Engine.** Refuse the move or apply a sensible default. Examples:
   - `end_combat` refuses a DM victory while `foesStanding` is non-empty.
   - `economyGate` / `gateMove` (`engine/economy.ts`) enforce the turn budget.
   - The target's AC is the default DC for an attack.
   - Fog turns on at the first scene.
   - `departureGate` (`game/readyCheck.ts`) asks the party before it leaves.
   - `record_physical_roll` ignores a repeat within 10 s.
   - `roll_dice` refuses an unknown roller, and `pick_up` refuses an empty take.
2. **Session.** Add nudges and caps in `realtime/session.ts`:
   - `nudgeStalledTurn` (uses `stalledTurn` from `engine/turns.ts`).
   - `nudgeEmptyFollowUp`.
   - `MAX_MOVES_PER_REPLY`.
3. **Persona.** Add one short line in `realtime/instructions.ts`. The persona is resent on every
   `session.update`, so keep it short.

Tool results steer the next step with fields such as `instruction`, `note`, `foes_standing`,
`victory_hint` and `passed`. A refusal is returned as `{error}` and logged as `[tool] name(id) -> error`.
Prefer a tool that does the hard part over asking the model to work it out. For example,
`planMove` and `findPath` route around walls the model cannot see.

**Bugs.** dm-narrates-without-tools, dm-stalls-on-monster-turn, dm-stalls-mid-player-turn,
dm-hunts-cells-around-lever, fog-never-enabled, attack-hit-not-checked-against-ac,
victory-with-foe-standing, turn-limits-not-enforced, physical-roll-recorded-twice,
move-narrated-through-wall, campaign-fails-on-single-pc-death, ai-player-leaves-without-party.

## 3. Never send on a closed socket; ignore superseded sessions

**Rule.** The Realtime sideband drops and reconnects. Anything sent while it is down is lost, and
events from an old socket arrive late.

**How.** In `realtime/session.ts`:
- A response that is still owed is the `wantResponse` flag, not a queued `response.create`.
- `conversation.item.*` messages wait in an outbox (`OUTBOX_MAX`) that flushes before the next
  response.
- The first-connect promise settles on every path, including close before open.
- Handlers check that the socket is still the current one (`this.ws !== ws`) and ignore it otherwise.
- A deliberate close sets `closedByCaller`.

**Bugs.** gate-timeout-lost-during-reconnect, blind-response-after-drop,
connect-promise-hangs-on-close, dead-call-record-kept, stale-dm-offline-status,
mic-stream-no-reconnect, closing-host-kills-dm. See [realtime sideband](../server/realtime-sideband.md).

## 4. Async work must re-check its context and have a deadline

**Rule.** The host can load another campaign while a map, sprite, icon or TTS job is still
running. An SDK call can also hang for many minutes. The OpenAI SDK defaults to 10 minutes per
attempt with 2 retries, and a stream's timer stops once headers arrive.

**How.**
- After every `await` in a long job, check the campaign id again before committing:
  `if (this.campaign?.id !== c.id) return;` in `game/service.ts`.
- Wrap every external call in `withDeadline(work, ms, onTimeout)` from `brain/provider.ts`, and
  pass an abort signal.
- Configure the timeouts: `BRAIN_TIMEOUT_MS`, `CONSULT_TIMEOUT_MS`, `IMAGE_TIMEOUT_MS`,
  `NPC_TTS_TIMEOUT_MS`, `AI_SPEAK_MAX_MS`.
- A timeout becomes a tool result the DM can act on. It is never a throw.

**Bugs.** generate-map-wrong-campaign, sprite-lands-in-other-campaign, ai-player-goes-mute,
brain-calls-slow-no-timeout, anthropic-stream-stall-timeout.

## 5. Derived copies go stale; refresh them where the change happens

**Rule.** The DM's instructions, host editors, browser caches and name lookups are all copies of
something else. Update each copy in the same place the original changes.

**How.**
- **DM instructions.** `GameService.runTool` calls `dm.refreshInstructions()` after scene
  changes, after the feature and door tools (`edit_map_feature`, `set_door`, `edit_walls`) and
  after the tools in `CREATURE_LIST_TOOLS` (the "NPCs here" and "Objects here" blocks). A new tool
  that changes what the instructions list must be added there.
- **Host actions.** A host action reaches the live DM as a silent note built by `hostActionNote`
  (`game/hostNote.ts`). Engine tools and service tools such as `end_campaign` take different
  paths, so check both.
- **Media cache.** `/media` is served `immutable` (`app.ts`), so a file that can change needs a
  versioned URL: `?v=<sha1>` for roster portraits, or a nonce in `imageFileName` for a forced
  repaint.
- **Host editors.** They track dirty fields (`host/editFields.ts`), so a state broadcast does not
  overwrite what the host is typing.
- **Names.** Trim and lower-case names on both the stored side and the lookup side
  (`sameItemName`, the item icon cache key).

**Bugs.** npcs-here-list-stale, dm-door-list-stale, host-actions-not-told-to-dm,
host-end-campaign-dm-unaware, roster-portrait-stale-cache, repaint-keeps-board-edits,
host-editor-stale-fields, item-icon-cache-case-sensitive, loot-item-names-untrimmed.

## 6. Undo restores GameState only

**Rule.** `restoreEntry` (`game/service.ts`) swaps the `GameState` snapshot back. Anything stored
outside `mutate()` is not restored and needs its own cleanup or repair.

**How.**
- Voiceprint rows: `dropVoiceprintsUndoneBy` and `pruneVoiceprints`.
- Item and loot icons drawn in the background: `repairLootIcons`, which runs after undo and on
  load.
- Board edits: `WallEdit.host` lets `resetForRepaint` drop only the edits the DM made.
- Fields the server owns (`walls`, `features`, `mapUrl`) are never taken from a client's copy of
  the outline (`mergeOutline`).
- Never delete a campaign directory with the reserved id `roster` (`assertNotRosterId`).

**Bugs.** roster-join-undo-orphan-voiceprint, loot-icons-lost-on-undo, dm-door-toggle-pins-walls,
outline-save-overwrites-walls, roster-media-dir-collision. See
[history and bundles](../server/history-and-bundles.md).

## 7. Nothing leaks through fog or `hidden`

**Rule.** The TV must not reveal a hidden or fogged creature through any side channel: a moment,
a chime, an effect or a spawn cell.

**How.**
- Every moment kind that has a target must be filtered in `momentForTable`
  (`table/visibility.ts`). Add new kinds there.
- Line of sight respects walls: `visibleCells` / `hasLineOfSight` in `packages/shared/src/los.ts`
  and `refogForWalls` (`engine/tools.ts`).
- Spawn cells respect `fog.hidden`.
- Anything drawn over the fog uses a transparent material, because the fog layer has
  `renderOrder -1`. An opaque mesh ends up under the fog.

**Bugs.** attitude-moment-leaks-hidden-monster, attacks-through-walls,
first-paint-fog-through-walls, fog-hides-effects, spawn-hidden-cells-in-light.

## 8. LLM structured output fills every optional field

**Rule.** OpenAI structured output writes a value for every optional field in the schema, often a
zero or an empty string. Leave fields the model should not choose out of the draft schemas in
`brain/content.ts`. Normalise free text that a code path relies on, for example
`normalizeSpellList` in `brain/spells.ts`.

**Bugs.** pregens-blind-in-fog (`lightRadius: 0`), pregen-spells-prose.

## 9. R3F: remount on texture changes, keep frame math pure

**Rule.** Switching a material from no texture to a texture needs a `key` remount, or the board
stays white (`MapBoard.tsx` keys the board material on `tex.uuid`). Math that runs in the frame
loop belongs in pure, tested helpers. One example: `Math.sin(Infinity)` gave a NaN matrix and
hid every standee, which `reactionPose` in `effectPlan.ts` now guards against.

**Bugs.** painted-map-white-board, standees-hidden-nan-pose, token-framing-and-billboards.

## How bugs get found

See [testing](../setup/testing.md#debugging-recipes): mine an exported event log by event
number, call tools directly over `POST /api/tools/<name>`, take timed screenshots of `/table`,
inject faults, and grep the log tags.
