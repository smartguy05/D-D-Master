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
---

# Table display (`/table`)

Open this page on the TV or second screen. It is read-only; everything is driven by `/ws` events.
Press **F** for fullscreen and **I** to show or hide inventories.

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

Cell (x, y) maps to world coordinates `(x − gridW/2 + 0.5, 0, y − gridH/2 + 0.5)`, with x
increasing to the right and y increasing toward the viewer. The DM's instructions describe the same
convention.
