---
title: Table display (/table)
area: web
topic: table
related_code:
  - apps/web/src/table/**
  - apps/web/src/styles/app.css
created: 2026-09-24
last_updated: 2026-09-24
last_audited: 2026-09-24
audited_by: claude
status: current
change_log:
  - "2026-09-24: Initial version; camera fit + billboard tokens"
  - "2026-09-24: Fog of war layer, torch lights, board effects, token hit flash, M mute toggle"
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
  gold, monsters are pink, and downed creatures are struck through.
- **Party sidebar**: one card per character.
  - Sprite, name, player, class, and a shield-shaped AC badge.
  - An animated HP bar (green, amber, red, with temp HP).
  - Condition chips and inventory chips with gold.
  - The card glows cyan while that character's player is speaking and gold on their turn.
  - Below the cards, the foes list shows vague health: healthy, bloodied, near death, defeated.
    Monsters standing in unexplored fog are left out of the foes list and the initiative strip.
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
- Textures are loaded once and cached by URL.

## Fog of war (`FogLayer.tsx`)

State: `GameState.fog[locationId] = { enabled, revealed: ["x,y", …] }` (see
[game-state](../reference/game-state.md)). Fog is **off** until `set_fog enable` for that location,
so old saves and outdoor scenes look unchanged. The engine keeps `revealed` up to date (see
[tools-engine](../server/tools-engine.md)); the table only renders it.

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

The server sends `{type:"effect", effect}` events (not persisted). `TablePage` keeps each for
`EFFECT_LIFETIME_MS` (2.2 s), stamped with the local receive time, and `MapBoard` places it at the
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
anything physical → slash). The target token also **shakes** and its standee **flashes** the
effect color for 0.55 s (a heal makes it bob instead).

## Coordinates

Cell (x, y) maps to world coordinates `(x − gridW/2 + 0.5, 0, y − gridH/2 + 0.5)`, with x
increasing to the right and y increasing toward the viewer. The DM's instructions describe the same
convention.
