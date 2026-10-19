---
title: Table display (/table)
area: web
topic: table
related_code:
  - apps/web/src/table/**
  - apps/web/src/styles/app.css
created: 2026-09-24
last_updated: 2026-10-19
last_audited: 2026-10-19
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-19: Effects wait for the dice tray (releaseHeld): d20 → damage dice → swing; a miss swings after the d20"
  - "2026-10-18: Token reaction pose moved to effectPlan.reactionPose (finite rest pose; a NaN offset had hidden every standee)"
  - "2026-10-18: PartyCard: death-save pips while dying, Stable badge, concentration badge; only Dead cards fully greyed"
  - "2026-09-24: Initial version; camera fit + billboard tokens"
  - "2026-09-24: Fog of war layer, torch lights, board effects, token hit flash, M mute toggle"
  - "2026-10-18: Board material keyed on the map texture (fixes white board after painting)"
  - "2026-10-18: Fog: host-hidden cells (revealedSet) render as fog"
  - "2026-10-18: visibility.ts: one rule for hidden/fogged monsters (tokens, foes, initiative, effects)"
  - "2026-10-18: rollForTable: hidden/fogged monsters' rolls show as anonymous DM rolls"
  - "2026-10-18: rollForTable uses useServer's latest-state ref"
  - "2026-10-18: Automatic attack/spell animations: effectPlan.ts (travel, impact timing, reactions, dedupe), swing/arrow/orb/area-ring recipes, hit/miss/crit token reactions, effect sounds"
  - "2026-10-18: Review 2: each suppressed repeat extends the dedupe window (cast → roll → damage chain)"
  - "2026-10-18: Review 1: outcome-less spell orbs land as a neutral spark; suppressed repeats wait for the earlier landing; TablePage prunes effects by age (cap 60)"
  - "2026-10-18: Allies: green tokens, green initiative entries, their own list; followers shown in fog"
---

# Table display (`/table`)

Open this page on the TV or second screen. It is read-only; everything is driven by `/ws` events.
Press **F** for fullscreen, **I** to show or hide inventories and **M** to mute or unmute dice
sounds (remembered per browser in `localStorage` key `dm.table.muted`; a 🔊/🔇 badge sits bottom
right of the map).

## Layout (`TablePage.tsx`)

- **Map layer** (to the left of a 360 px sidebar): `MapBoard`, a React Three Fiber scene.
- **Scene title** (top left): the campaign title and the current location.
- **Initiative strip** (top center, during combat): the round, then each entry. The current turn is
  gold, monsters are pink, allies (friendly NPCs) green, and downed creatures are struck through.
- **Party sidebar**: one card per character.
  - Sprite, name, player, class, and a shield-shaped AC badge.
  - An animated HP bar (green, amber, red, with temp HP).
  - Rules state, in large type for across the room (`deathSaveView` from `player/sheet.ts`):
    - while at 0 HP and dying, a red box with ✔ ○○○ (successes, green) and ✖ ○○○ (failures, red);
    - **✚ Stable** badge once stable;
    - **◎ <spell>** badge (cyan) while the character concentrates.
    A downed card greys only the header and HP bar so the pips keep their colours; a **Dead** card is
    fully greyed.
  - Condition chips and inventory chips with gold.
  - The card glows cyan while that character's player is speaking and gold on their turn.
  - Below the cards, the foes list shows vague health: healthy, bloodied, near death, defeated.
    Monsters standing in unexplored fog are left out of the foes list and the initiative strip.
    Allies (`ally: true`) get their own green list above the foes; on the map their tokens have a
    green ring and a neutral base.
- **DM orb** (bottom left): offline, connecting, listening (cyan), thinking (purple, pulsing) or
  speaking (gold, pulsing), plus "🎙 Sam (Thorin)" for the current speaker.
- **Physical roll banner**: "🎲 Lyra, roll 1d20+2 for Perception!" while `pendingRoll` is set.
- **Dice overlay and roll toast**: see [dice-3d](dice-3d.md). Rolls are **queued**, so back-to-back
  attack and damage rolls animate in order. Each toast shows the roller, label, total, the kept dice
  and modifier, NAT 20 or natural 1, and success or fail against the DC.
- **Jobs**: "✦ Painting map: Chapel Nave…" while images generate.

## 3D board (`MapBoard.tsx`)

- The board is a plane of `gridW × gridH` units (1 unit = one 5-ft square), textured with the
  location's `mapUrl`, or dark wood if there is no map. It sits on a raised table edge, with a grid
  drawn as line segments at 28% opacity.
- `FitCamera` computes the distance needed to fit the grid from the fov and aspect ratio, and places
  the camera high and slightly toward the viewer. `OrbitControls` allows panning and zooming (polar
  angle limited).
- **Tokens** (`TokenMesh`):
  - A dark base cylinder and a colored ring. The ring pulses gold on the creature's turn and cyan
    while it speaks.
  - A camera-facing billboard standee showing the sprite (transparent PNG), or colored initials
    until the sprite exists.
  - A floating HP bar.
  - Tokens lerp to their new cell with a small hop. Downed creatures turn grey and translucent.
- Textures are loaded once and cached by URL. The board material is keyed on the texture, so a
  map that finishes loading (or a repaint) mounts a fresh material; patching `map` onto the
  compiled fallback material would not recompile its shader and leaves the board plain white.

## Fog of war (`FogLayer.tsx`)

State: `GameState.fog[locationId] = { enabled, revealed: ["x,y", …], hidden: [...] }` (see
[game-state](../reference/game-state.md)). Fog is **off** until `set_fog enable` for that location,
so old saves and outdoor scenes look unchanged. The engine keeps `revealed` up to date (see
[tools-engine](../server/tools-engine.md)); the table only renders it. The table uses
`revealedSet(fog)` (revealed minus the cells the host hid from the Board tab), so hidden cells
always render as fog and monsters in them stay hidden.

**What the TV may show** is decided in one place, `visibility.ts` (tested): `monsterShownOnTable`
hides monsters with `hidden` (ambush) or standing in unseen fog (an ally that follows the party is
shown even in fog), for the map tokens, foes list and
initiative strip; `effectForTable` drops effects that land on such a monster and removes a hidden
attacker's `sourceId` (no bolt from its secret position, but the hit on the target still plays).
`rollForTable` (used by `onRoll` with the newest state `useServer` received, set synchronously in
the `state` case, so a roll right after a hide is judged on the new state; before the dice tray and toast) turns a roll by such a monster
into an anonymous DM roll: roller "DM", no label (the toast shows the notation), no roller id. The
dice and total still show, like a DM rolling in the open, so nothing names or locates the creature.

- **3D shroud**: one plane over the board, subdivided 4× per cell. A `DataTexture` with one texel
  per cell (linear filtered, so edges are soft) holds the fog amount. The vertex shader pushes
  fogged vertices up into a rolling smoke blanket (fbm noise, drifting over time). The fragment
  shader shades it from derivative normals, with a moving swirl.
- **Smooth reveal**: each frame the per-cell values ease toward their target (0 revealed, 1 fogged),
  so newly revealed cells sink and fade in about half a second. Disabling fog fades it all out; a
  new map starts at its target with no fade.
- It renders first among transparent objects (`renderOrder -1`, no depth write), so tokens and
  effects stay visible over the shroud.
- **Hidden monsters**: monster tokens in unrevealed cells are not drawn, and effects that target
  a hidden cell are skipped. Characters are always inside their own light.

## Light (`TorchLight`)

While fog is enabled, the scene lights dim to 60% and each character carries a flickering warm
point light with `distance = lightRadius + 2` (default radius 6 cells, see `DEFAULT_LIGHT_RADIUS`).
**Line of sight is a plain radius**: there is no wall or door data yet, so light and vision pass
through everything. Walls will need map editing first (TODO in `.memories/features/table-display.md`).

## Board effects (`Effects.tsx`)

The server sends `{type:"effect", effect}` events (not persisted). `TablePage` first **holds**
each one until the dice tray is done (`effectPlan.releaseHeld`, pure, tested): everything waits
while dice roll or are queued; once the tray is idle, a hit/crit `attack` waits up to
`DAMAGE_GRACE_MS` (3 s) more for its damage roll unless the matching `hit` (apply_damage, same
source and target) is already held; a miss is released at once. Arrival order is kept and nothing
is held past `HOLD_CAP_MS` (15 s). `onRoll` marks the tray busy synchronously because a roll's own
effect arrives right behind it. A released effect is kept for
`EFFECT_LIFETIME_MS` (2.8 s; pruned by age only, with a safety cap of 60), stamped with the local release time, and `MapBoard` places it at the
target token (or the `x, y` cell), with the source token for bolts. Every effect is real 3D and
self-timed from its mount:

| Visual | Built from |
|---|---|
| `slash` (plain hits) | two sweeping additive torus arcs, red flash light, blood-red sparks |
| `crit` | gold and white slash arcs, ground shockwave, gold spark burst, bright flash |
| `fireball` | expanding additive icosphere (orange shell, white-hot core) sized to `radius`, orange point light, shockwave, embers, rising smoke |
| `lightning` | jagged tube bolt (core + glow) regenerated 20×/s from the source token (arcing over the fog) or the sky, blue flash, sparks |
| `frost` | ring of translucent ice cones growing out of the ground, frost motes |
| `poison` | spreading green cloud (normal-blended particles) plus bubbles |
| `radiant` | open light pillar, golden flash, rising motes |
| `necrotic` | purple particles spiralling inward, dark ring |
| `thunder` | stacked shockwave rings, dust kicked outward |
| `arcane` | runic rings, violet orb, sparkles |
| `heal` | green ground ring, spiralling green-gold sparkles rising, green light |
| `miss` | grey dust puff and ring |

A plain `hit` picks its visual from the damage type (`fire` → fireball, `cold` → frost, …;
anything physical → slash).

### Attacks and spells (automatic)

The server emits these without the DM asking (see `docs/server/tools-engine.md`): `attack` effects
from attack rolls with a `target_id` and from `cast_spell`, `hit` effects with a `sourceId` and
`style` from `apply_damage` with `source_id`, and `area` effects for area spells. `effectPlan.ts`
(pure, tested) decides once per effect, when it is first placed:

| Plan | Rule |
|---|---|
| travel | `style` melee → **Swing** (white + coloured blade arc sweeping across the target from the attacker's side, 260 ms); ranged → **Arrow** (shaft, steel head, fletching, flying nose-first on a shallow arc, 200–600 ms by distance); spell → **SpellOrb** (white core, element-coloured glow and a 7-step fading trail, 260–700 ms; `count` darts curve apart, 90 ms apart); spell + lightning → the lightning bolt; `area` → an orb lobbed from the caster (not for emanations) |
| impact | at the end of the travel: `outcome` crit → `crit`, miss → `miss` (a missed arrow/orb ends beside and past the target); spell with an outcome → element visual (without one, e.g. `cast_spell` Fire Bolt before its roll, a small neutral `spark`); melee hit → `slash`; otherwise `spark` (small flash + sparks). `hit` uses its damage type. `area` → **AreaRing** (ring at exactly `radius` cells, faint disc and dome, flash) plus the element visual at that radius |
| reaction | the target token at impact time: hit = shake + flash; crit = bigger shake, hop and brighter flash; miss = sidestep (dodge), no flash; heal = bob. An `area` shakes every token inside the ring. An `attack` with no outcome (no dc) has no reaction |
| no travel | no source token on the table (DM roll, hidden attacker stripped by `effectForTable`), source on the target's cell, or a **repeat**: the same source→target pair already travelled within `TRAVEL_DEDUPE_MS` (1.5 s, measured from the latest repeat so cast → roll → damage is one chain; `travelSuppressed` names the effect that travelled). A repeat's impact waits until the earlier travel lands, so a hit/miss never shows before the orb; the other cases land at once. A distance ≤ 0.5 cell never travels |
| sounds | `dice/sound.ts` `playEffectSound`: travel whoosh (melee), twang (bow), zap (orb), crackle (lightning); impact thud (hit/spark), clang (crit), whiff (miss), boom (fire/thunder/area), crackle (lightning), chime (heal/radiant), zap (cold/arcane/necrotic/poison). Muted with **M** like the dice; each effect sounds once (StrictMode-safe) |

The dedupe runs on the table because the engine is pure and has no clock: e.g. `cast_spell` Fire
Bolt flies an orb, and the attack roll a moment later only shows its hit/miss; an attack roll then
`apply_damage` with `source_id` shows the damage burst without a second swing. A plan never
changes once made, so an earlier effect expiring cannot start a travel late. Every travel is under
1 s; the impact visuals fade within ~1.8 s.

## Coordinates

Cell (x, y) maps to world coordinates `(x − gridW/2 + 0.5, 0, y − gridH/2 + 0.5)`, with x
increasing to the right and y increasing toward the viewer. The DM's instructions describe the same
convention.
