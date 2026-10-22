---
title: Table display (/table)
area: web
topic: table
related_code:
  - packages/shared/src/visibility.ts
  - apps/web/src/table/otherGroups.ts
  - apps/web/src/lib/TurnBudgetChips.tsx
  - apps/web/src/table/**
  - apps/web/src/styles/app.css
created: 2026-09-24
last_updated: 2026-10-22
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: TablePage split: the scene and its dice holds moved to TableScene.tsx (useTableScene + TableScene), shared with the remote /play page; TV behaviour and timing unchanged. Secret roll toast shows only the notation and ? (rollToastView; bugs/secret-roll-toast-shows-dice.md). liveTurnId/HIDDEN_TURN for a projected hidden turn"
  - "2026-10-22: Room mic stays open while a voice is enrolled (FloorView.enrolling)"
  - "2026-10-22: Hold Space to talk to the DM (push-to-talk); the room mic follows the floor; ptt banner"
  - "2026-10-22: Visibility rules moved to @dm/shared (table/visibility.ts re-exports them); the TV stays a full-tier socket"
  - "2026-10-21: Billboard standees face the camera on every axis (lockX/lockZ looked squashed); links to the moments and loot docs"
  - "2026-10-21: /table carries the voice call (useTableVoice, voicePlan auto-resume, voice pill); unlock overlay mentions the DM's voice (bugs/closing-host-kills-dm)"
  - "2026-10-21: Enable-sound overlay while autoplay is locked (lib/audioUnlock.ts); clickable mute badge; clipSpeaker keeps the focused NPC's portrait for a bare-name clip"
  - "2026-10-21: AI player lines take the close-up (closeupSubject; pc style), even with no NPC in focus"
  - "2026-10-20: Interactable marker is now a soft cell-shaped glow with twinkling stars (no ring, disc or shimmer wall); used interactables are hidden"
  - "2026-10-20: Party split: other-groups line under the location name; away PCs dimmed with an @ tag"
  - "2026-10-20: Active party card shows spell slots and class resources (tableRulesView, .pc-rules)"
  - "2026-10-20: boardHold: HP changes and removed monsters wait for the dice (displayState)"
  - "2026-10-20: Battle intro (combat_start overlay, initiativeForTable, introTiming); dice wait for intro and turn banners (holdsDice)"
  - "2026-10-20: Turn marker waits for the dice (momentPlan.shownTurn, MapBoard turnId, nowPanelFor turnId)"
  - "2026-10-20: app.css: host-only roster classes (.roster-portrait, .roster-entry, .roster-prompt); no TV change"
  - "2026-10-20: Attitude badges in the ally/foe lists, attitude ring colours, attitude moment ring flash (ringFlash), momentForTable drops hidden monsters' attitude moments"
  - "2026-10-20: Loot markers (loot sack billboard, chest fallback, sparkles), interactable auras, pick-up toast, item icons in party inventory (mapObjects.ts, mapObjectShownOnTable, interactiveFeatureShownOnTable)"
  - "2026-10-20: Tokens stay standing while their death moment is held (heldStanding/tokenFallen)"
  - "2026-10-20: Light section no longer claims there are no walls (bugs/table-doc-stale-line-of-sight.md)"
  - "2026-10-20: Moments: overlays (MomentOverlay, momentPlan), token death/revive animations, turn spotlight, Now panel (nowPanel.ts), momentForTable"
  - "2026-10-20: Doors drawn as 3D slabs (doors.ts doorTransform/doorVisible); fog follows line of sight; roll toast shows cover"
  - "2026-10-20: Token colours shared via lib/tokenColor.ts"
  - "2026-10-20: Orb shows Muted while the table mic is muted (orb.ts)"
  - "2026-10-20: Orb shows Muted while the table mic is muted (orb.ts)"
  - "2026-10-20: Neutral creatures (amber, no list); knocked-out allies"
  - "2026-10-19: Turn budget chips under the initiative strip"
  - "2026-10-19: Fog starts on at first arrival for locations with fog: true"
  - "2026-10-19: P toggles the table mic mute; muted banner"
  - "2026-10-19: NPC close-up with paced subtitles (NpcCloseup, caption.ts)"
  - "2026-10-19: Live who's talking: pulsing party card, level bar, live speaker tag (lib/talk.ts)"
  - "2026-10-19: Join QR: Q toggles a corner card, big QR on the waiting screen"
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

Open this page on the TV or second screen. The board is read-only and driven by `/ws` events, but
this page also **carries the voice DM's call**: the table mic, the DM's audio and the WebRTC call
(see [Voice call](#voice-call-usetablevoicets)). Keep it open during voice play.
Press **F** for fullscreen, **I** to show or hide inventories and **M** to mute or unmute table
sounds: dice, effects and NPC clips (remembered per browser in `localStorage` key `dm.table.muted`;
the 🔊/🔇 badge bottom right of the map toggles it too when clicked). **P** mutes or unmutes the table mic (`/api/mic`, so the party can talk without
the DM hearing); while muted a red "The DM isn't listening" banner sits at the top of the map.
With push-to-talk on, **hold Space** to talk to the DM for the room (`lib/floor.ts` `isTalkKey`;
key repeats ignored, released on keyup or when the window loses focus). The room mic reaches the DM
only while the room or a home-network phone holds the floor, plus 600 ms, or while a voice is being
enrolled (`floor.enrolling`) (`useTableVoice`); a
banner at the top says "Hold Space…" or who is talking to the DM (gold). See
[push-to-talk](../server/realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts). **Q** shows or hides a join card (QR code for `<base>/player`, the phone
picker) at the top right of the map; before a campaign is loaded the waiting screen shows it large. The
base comes from `lib/join.ts` (`PUBLIC_URL`, else the LAN address when the TV is on localhost) and
`lib/Qr.tsx` draws it (`qrcode` package, inline SVG, white quiet zone).

## Layout (`TableScene.tsx`, `TablePage.tsx`)

The scene is `table/TableScene.tsx`: `useTableScene(role)` owns the `/ws` connection, the dice
queue and every hold behind the dice (boardHold, effectPlan, momentPlan, unchanged); `TableScene`
draws it. `TablePage` (the TV) adds the voice call, the hotkeys, the join QR and the room's
push-to-talk and mic banners through the scene's slots (`banners`, `controls`, `corner`), so the DOM
order is what it was. The remote [/play page](remote-play.md) renders the same scene on a player
socket (projected state): `liveTurnId` (`nowPanel.ts`) turns a projected `turnIndex: -1` into
`HIDDEN_TURN`, which the turn hold treats like any turn and the Now card shows as **Unknown foe**.


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
    - **◎ <spell>** badge (cyan) while the character concentrates;
    - on the **active** card only (the turn holder in combat, else whoever is talking), spell
      slots by level (Pact Magic in cyan) and limited-use resources (Rage, Channel Divinity…) as
      pips, or `left/max` for big pools like Lay On Hands (`tableRulesView`, `.pc-rules`).
    A downed card greys only the header and HP bar so the pips keep their colours; a **Dead** card is
    fully greyed.
  - Condition chips and inventory chips with gold; an item with an `iconUrl` (drawn when it was
    dropped as loot) shows its small icon before the name.
  - The card glows cyan while that character's player is speaking and gold on their turn. While a
    `talk` event says someone is talking **right now** and voice ID already matched them
    (provisional), their card pulses and shows a live mic-level bar; the last turn's speaker glow
    is hidden meanwhile.
  - Below the cards, the foes list shows vague health: healthy, bloodied, near death, defeated.
    Monsters standing in unexplored fog are left out of the foes list and the initiative strip.
  - Under the initiative strip, the **Now panel** (`.now-panel`, `nowPanel.ts` `nowPanelFor`,
    pure, tested): the current creature's portrait (`spriteUrl`), name, HP and condition chips,
    plus the **turn budget** (`lib/TurnBudgetChips.tsx`: movement left, Action or "Action (1/2
    attacks)", Bonus and Reaction chips, used ones dimmed; see
    [turn economy](../gameplay/turn-economy.md)). A PC shows exact HP ("7/12"); a monster shows
    only an HP band (`hpBand`: the same healthy / bloodied / near death / defeated thresholds as the
    foes list, which now uses it too). On a hidden monster's turn (`monsterShownOnTable`) it shows
    just "Unknown foe": no portrait, HP, conditions or budget chips.
    Allies (`ally: true`) get their own green list above the foes; on the map their tokens have a
    green ring and a neutral base (`lib/tokenColor.ts`, shared with the host Board). A knocked-out ally (0 HP) reads "knocked out", not "defeated".
    Neutral creatures (`neutral: true`, set_disposition) are on neither list and get an amber ring.
    Each listed creature shows an **attitude badge** (`lib/attitudeBadge.ts`, e.g. "🙂 Friendly +3",
    coloured by `lib/tokenColor.ts` `monsterColor`). Token rings follow the attitude
    (`attitudeOf`): hostile red, indifferent amber, friendly green.
- **DM orb** (bottom left, `table/orb.ts`): offline, connecting, listening (cyan), thinking (purple,
  pulsing) or speaking (gold, pulsing); while the table mic is muted a listening DM shows **Muted**
  (dim red), matching the banner (a DM answering a typed message still ponders), plus "🎙 Sam (Thorin)" for the current speaker. While someone talks it
  shows "🎙 Sam (Thorin)…" (or "🎙 Someone's talking…" before voice ID is sure) with a level bar.
  The level never goes through React state: `lib/talk.ts` `setTalkLevel`/`onTalkLevel` paint the
  `--lvl` CSS variable of each `TalkLevel` bar; `reduceTalk` keeps `view.talk` the same object
  when only the level moved, so the 3D map doesn't re-render ~8 times a second.
- **Physical roll banner**: "🎲 Lyra, roll 1d20+2 for Perception!" while `pendingRoll` is set.
- **Dice overlay and roll toast**: see [dice-3d](dice-3d.md). Rolls are **queued**, so back-to-back
  attack and damage rolls animate in order. Each toast shows the roller, label, total, the kept dice
  and modifier, NAT 20 or natural 1, cover when the target had some (`coverNote` from `los.ts`:
  "· vs AC 15 (half cover +2)", never on a secret roll), and success or fail against the DC. A
  **secret** roll's toast shows only the roller, label, notation and **?**: no dice, modifier,
  natural, cover or result (`rollToastView` in `table/rollToast.ts`; it used to list the kept dice,
  bugs/secret-roll-toast-shows-dice.md).
- **Pick-up toast** (`PickupToast`, bottom center): each `{type:"pickup"}` event (a `pick_up`,
  never persisted) shows the item icons (a name chip while an item has no icon yet, plus a gold
  chip) and `pickupToastText` ("Sylvaine picks up Dagger x2, 15 gp"). Up to three stack; each hides
  after 5 s. `useServer` hands the event to its 5th listener, `onPickup`.
- **Jobs**: "✦ Painting map: Chapel Nave…" while images generate.

Party split (`otherGroups.ts`, [party split](../gameplay/party-split.md)): the TV draws the scene
in focus. Under the location name, one line per other group ("Bram · Old Mill · ⏸ ⚔ round 2"),
and away PCs' party cards are dimmed with an "@ Old Mill" tag.

## 3D board (`MapBoard.tsx`)

- The board is a plane of `gridW × gridH` units (1 unit = one 5-ft square), textured with the
  location's `mapUrl`, or dark wood if there is no map. It sits on a raised table edge, with a grid
  drawn as line segments at 28% opacity.
- `FitCamera` computes the distance needed to fit the grid from the fov and aspect ratio, and places
  the camera high and slightly toward the viewer. `OrbitControls` allows panning and zooming (polar
  angle limited).
- **Tokens** (`TokenMesh`):
  - A dark base cylinder and a colored ring (attitude colour for monsters/NPCs). The ring pulses
    gold on the creature's turn and cyan while it speaks. During an `attitude` moment it swells and
    glows in the new attitude colour (`momentPlan.ringFlash`, three pulses over 1.5 s).
  - A camera-facing billboard standee showing the sprite (transparent PNG), or colored initials
    until the sprite exists. The drei `<Billboard>` faces the camera on every axis on purpose:
    with `lockX`/`lockZ` the standees looked squashed from the steep TV camera.
  - A floating HP bar.
  - Tokens lerp to their new cell with a small hop. Downed creatures turn grey and translucent.
  - **Turn spotlight**: on the creature's turn the gold ring pulses wider, a soft additive light
    beam (open cone) shines down on it and a gold point light breathes with it. A hidden monster
    has no token, so its turn shows no spotlight. The marked turn (spotlight, initiative strip
    `now`, party/foe `turn`, Now card) is `momentPlan.shownTurn`, not the state's `turnIndex`:
    the state moves on at `next_turn` while the last attack's dice still roll, so TablePage keeps
    the previous creature marked until the dice, held effects and held moments finish (with the
    turn banner), or HOLD_CAP_MS passes; combat ending clears it at once. MapBoard takes it as
    `turnId`, `nowPanelFor(state, turnId)` builds the Now card from it.
  - **Fallen pose** (from state, so a reload shows it): a Dead PC (`isDeadChar`) or a foe at 0 HP
    lies on its side (the standee group inside the billboard rotates around its foot) and is tinted
    grey. Allies at 0 HP stay upright. See [moments](#moments) for the animated versions.
- Textures are loaded once and cached by URL. The board material is keyed on the texture, so a
  map that finishes loading (or a repaint) mounts a fresh material; patching `map` onto the
  compiled fallback material would not recompile its shader and leaves the board plain white.
- **Doors** (`Doors`, `doors.ts`): each `door` segment of `effectiveWalls(state, loc)` is a thin
  wooden slab (`DOOR_THICKNESS` 0.12 × `DOOR_HEIGHT` 0.8) on its grid edge. `doorTransform(seg,
  loc)` gives its world position, Y rotation and length: a closed door lies along the edge; an open
  door is swung a quarter turn about its `(x1, y1)` end and drawn translucent. With fog,
  `doorVisible(seg, revealed)` hides doors with no explored cell on either side. Plain walls and
  windows draw nothing (they are painted on the map; the host board shows them). A `set_door` or
  host toggle updates the TV with the next `state` broadcast, and fog beyond a wall stays dark
  because the engine reveals only cells in line of sight (`visibleCells`).

## Loot and interactables (`mapObjects.ts`, `visibility.ts`)

The gameplay side (tools, icons, the DM's Objects here block) is in
[loot and interactables](../gameplay/loot-and-interactables.md).

Map objects (`state.mapObjects`, made by `drop_loot`, `place_interactable` or the host) and
interactive map features (`MapFeature.interactive`) are planned by pure, tested helpers:

- `mapObjectShownOnTable(state)(obj)` (`visibility.ts`): false when the object is `hidden`, belongs
  to another location, or its cell is in unrevealed fog (fog off: shown).
- `interactiveFeatureShownOnTable(state)(f)`: only `interactive` features with at least one visible
  cell.
- `lootMarkers(state)`: the shown loot objects `{id, x, y, iconUrl?}`.
- `auraPlan(state, features)`: auras `{key, x, y, w, h}` for shown interactables (1×1, left out
  once `used`) and shown interactive features of `effectiveFeatures(state, loc)`. The phone map
  uses the same plan.
- `pickupToastText(pickup)` for the pick-up toast.

`MapBoard` draws:
- **Loot** (`LootMesh`): the generated loot-sack picture (`MapObject.iconUrl`, set by the server
  after `drop_loot`) as a billboard, or a small wood-and-gold chest mesh until it exists or loads.
  It bobs gently and a ring of golden glints (`Sparkles`, additive points) twinkles around it.
- **Auras** (`AuraMesh`): a soft cyan glow shaped to the cells (a plane with a rounded-square
  falloff texture, `auraGlowTexture`) whose brightness breathes slowly, plus 3–8 small four-point
  stars (`auraStarTexture`, per-vertex colours) that each twinkle in place on their own phase.
  Nothing grows or moves. Additive, transparent and `depthWrite={false}` so the fog shroud never
  hides them (`.memories/bugs/fog-hides-effects.md`). Used interactables are not drawn.

Nothing is drawn for hidden objects, other locations, or cells in unexplored fog.

## Fog of war (`FogLayer.tsx`)

State: `GameState.fog[locationId] = { enabled, revealed: ["x,y", …], hidden: [...] }` (see
[game-state](../reference/game-state.md)). Fog turns **on** when the party first arrives at a
location whose outline entry has `fog: true` (the default; shops and inns set it false), and
`set_fog` or the host's Board tab can switch it later. A location with no fog entry shows no fog. The engine keeps `revealed` up to date (see
[tools-engine](../server/tools-engine.md)); the table only renders it. The table uses
`revealedSet(fog)` (revealed minus the cells the host hid from the Board tab), so hidden cells
always render as fog and monsters in them stay hidden. The engine reveals cells by line of sight
(`los.ts` `visibleCells`), so walls and closed doors keep the rooms behind them, and the monsters
in them, dark with no change to `visibility.ts`.

**What the TV may show** is decided in one place, `visibility.ts` (tested). The rules live in
`packages/shared/src/visibility.ts` (tests in `visibility.test.ts` there) and `table/visibility.ts`
re-exports them, because the server uses the same rules to filter what player sockets receive
([state projection](../server/state-projection.md)). The TV itself is a full-tier socket: it still
gets the whole state and filters at render time, so its dice and moment timing are unchanged.
`monsterShownOnTable`
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
The torch light itself is a plain 3D point light and shines through walls, but what the party
sees does not: the engine reveals fog only for cells in line of sight within the light radius
(`los.ts` `visibleCells`, walls and closed doors block it), so rooms behind walls stay fogged.

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

## Moments

Kinds, where the server emits them and how to add one: [moments](../gameplay/moments.md). The
invariant behind the holds below is in [design rules](../architecture/design-rules.md) §1.

The server sends `{type:"moment", moment}` events (transient, never in the snapshot; see
[data flow](../architecture/data-flow.md)) for victory, defeat, fled, death, revived (or
`outcome: "rallied"`: back up from 0 HP), turn_start, campaign_end and attitude (an NPC's
attitude crossed a threshold; `outcome` is the new attitude). `useServer`'s `onMoment`
gets each one with the latest state, and `TablePage`:

1. **Filters** it with `visibility.ts` `momentForTable`: a death, revival, turn banner or attitude
   flash of a monster the table can't see is dropped (no banner or chime gives an ambusher away).
2. **Holds** it behind the dice and the board effects (`momentPlan.releaseHeldMoments`): nothing
   goes while dice roll or effects are still held, then everything in arrival order; anything held
   `HOLD_CAP_MS` (15 s) goes anyway. So the killing blow's dice and swing play before the monster
   falls, and the victory banner after that.
3. **Plays** it by variant (`momentVariant`): `death` + `outcome:"monster"` is `monster_death`,
   `revived` + `outcome:"rallied"` is `rallied`.

| Variant | Where | `MOMENT_MS` | Look | Sound |
|---|---|---|---|---|
| victory | overlay | 4.5 s | gold "VICTORY" slam, rising gold sparks | victory |
| defeat | overlay | 5 s | dark vignette, grey drooping "DEFEAT" | death |
| fled | overlay | 3.5 s | blue "ESCAPED" dashing in | fumble |
| death | overlay + token | 4 s | red-black vignette, greyed portrait, "<name> has fallen"; token tips over and greys, dark mist | death |
| monster_death | token only | 2.5 s | lighter mist, token tips over, a little less grey | thud |
| revived | overlay + token | 3.5 s | golden light beam, "<name> returns to life"; token rises inside a golden column with sparks | revive |
| rallied | toast | 3 s | green "✚ Mara is back up!" pill | chime |
| turn_start | overlay | 2 s | "Mara's turn" pill banner with the portrait | chime |
| combat_start | overlay | 5.5 s | battle intro: "⚔ Roll for initiative ⚔", the order dealt out as cards (`initiativeForTable`: hidden/fogged monsters left out; initiative number spins in; foes on dark red), then "Battle begins!" (`introTiming` fits any order length) | battle |
| attitude | token only | 1.5 s | the token ring swells and glows three times in the new attitude colour (`ringFlash`); no banner | chime |
| campaign_end | overlay | 8 s or click | party portraits, names, levels and classes (fallen heroes greyed), the epilogue (`moment.text`); gold for success, dark for failure | campaign |

- **Overlay queue** (`emptyMomentQueue`, `enqueueMoment`, `nextOverlay`, `dismiss`; pure, never
  mutated): full-screen variants play one at a time, FIFO, each for its `MOMENT_MS`. A new
  turn_start replaces a turn banner that hasn't shown yet. rallied and monster_death never take the
  slot. A click on the campaign-end screen dismisses it. A 200 ms interval advances the queue and
  the overlay's sound plays when it actually shows.
- **The board lags the dice** (`boardHold.ts`, pure, tested): the server applies damage and
  removes a dead monster as soon as the DM calls the tools, often while the attack's dice are still
  rolling. TablePage keeps `live` (the server state) and draws `state = displayState(live, hold)`:
  while dice roll or effects/moments are held, an HP change keeps the old value and a monster
  removed from the state stays on the board with its token; after the dice the HP drops, the death
  moment plays and the lingering monster goes when its token animation ends (HOLD_CAP_MS cap; a
  scene change drops it). `holdBoard` runs in `syncBoard` with the turn marker (`shownTurn`).
- **Dice wait for the intro and turn banners** (`holdsDice`): the dice tray doesn't start its next
  roll while a combat_start or turn_start overlay shows, so a monster that wins initiative only
  attacks after the table has seen the order and its turn banner. The turn spotlight
  (`shownTurn`) also waits through the intro.
- **Overlay** (`MomentOverlay.tsx`, CSS only like `CritBurst`; keyframes `mo-*` in `app.css`,
  `--mo-dur` = the variant's duration). It covers the map, not the sidebar, except campaign end
  which covers everything.
- **Token animation** (`MapBoard` `TokenMesh`, `TokenView.moment`): `tokenMomentPose(variant,
  ageMs)` (pure, clamped, always finite) gives `{tilt, desaturate, column}`: death tips 0 → π/2
  in ~1 s (eased, monotonic) and greys 0 → 1; revived lifts π/2 → 0 while the golden column swells
  and fades by the end. Ages < 0 or past the end give the end pose. When the moment expires, the
  token eases to the pose the state implies (fallen or upright). The state arrives before the
  dice finish, so while a death moment is still held TablePage passes its target in `standing`
  (`momentPlan.heldStanding`) and `tokenFallen` keeps that token upright: it tips over with the
  moment, after the killing blow, not during the dice. Mist and sparks reuse the
  `Effects.tsx` `Particles` (exported). All per-frame steps use `Math.min(dt, 0.1)`.

## Coordinates

Cell (x, y) maps to world coordinates `(x − gridW/2 + 0.5, 0, y − gridH/2 + 0.5)`, with x
increasing to the right and y increasing toward the viewer. The DM's instructions describe the same
convention.

## Enable sound (autoplay lock)

Browsers block sound until someone interacts with the page: the dice `AudioContext` starts
suspended and NPC clips (`HTMLAudioElement.play()`) are refused with `NotAllowedError`. While the
page is locked and not muted (or a voice DM is live), a large pulsing **🔊 Click to enable sound**
button sits over the map; with a live voice DM it reads **Click to enable sound and the DM's
voice**, since a refused `play()` of the DM's audio locks it too (`onRemoteAudioBlocked`) and the
click re-plays it (`retryRemoteAudio`). Any click or key press unlocks (`dice/sound.ts` `unlockAudio`, which resumes the context and
plays a silent clip inside the gesture, `lib/audioUnlock.ts`); the overlay goes once both work.
On load the page tries once without a gesture, so a browser that allows autoplay (kiosk flags)
never shows it. If a clip is still refused later, `NpcClipPlayer` reports the lock
(`onBlocked` → `markAudioLocked`) and the overlay comes back; that clip counts as ended, so the DM
is never held up.

## Voice call (`useTableVoice.ts`)

`TablePage` calls `useTableVoice(view)`, which owns the `VoiceLink`, the table mic and its
`MicStreamer("table")` (voice ID). `/host` only sends `voice_command`s (start, stop, reconnect) and
reads the state this page reports as `voice_link`. The first start shows the browser's mic prompt
in this tab. Stop releases the mic. It also drives the planned
[handover](../server/voice-handover.md), applies the table mic mute, and re-reports its state after
a `/ws` reconnect. A reloaded page rejoins a running voice DM by itself once
(`voicePlan.ts` `shouldAutoResume`: voice mode, DM not offline, this link idle, the server says no
table carries a call) with a `?resume=1` call, so the DM doesn't greet again. Closing the tab ends
the call; reopened within about 30 s it resumes, later the host presses Start. While the call is
connecting, reconnecting or failed, a `🎙 voice: …` pill is shown. Details:
[voice ownership](../server/voice-ownership.md).

## NPC close-up (`NpcCloseup.tsx`, `caption.ts`)

While the DM voices an NPC (`npc_focus` event, from the `npc_focus` tool or `speak_as_npc`), the
NPC's portrait (its token sprite or pre-drawn outline portrait, else its initial) slides in at the
bottom left with a name plate and a subtitle bar, and pulses while the DM (or the NPC's clip) is
speaking. The DM orb says "Mira Thornwood speaks…". Between lines the portrait shrinks to a docked
round card at the top left until the focus is cleared.

Subtitles come from `caption` events (the DM's transcript) and `npc_speech` clip lines, through
`lib/talk.ts` `pushCaption`/`onCaption` (not React state, so the map doesn't re-render per piece).
`caption.ts` (pure, tested) paces them: pieces of one reply are appended and the final text
replaces them; the text is revealed at `CAPTION_CPS` (15 chars/s, cut at a word) from the first
piece, since the transcript runs ahead of the audio; when the voice stops (`dm_status` leaves
speaking) a final line shows in full and fades after `CAPTION_LINGER_MS` (4 s). A clip's line is
timed by its own length (`clipLine`). A new NPC starts with an empty line.

**AI player lines.** An AI player's clip (`npc_speech` with `pc` and `portraitUrl`) carries its
speaker into the line (`clipLine(line, clipSpeaker(c))`). `clipSpeaker` only returns a speaker
for a clip that brings its own face (`pc` or a `portraitUrl`); a bare-name NPC clip ("Venn" while
"Captain Mara Venn" is in focus) has none, so the focused NPC's portrait stays up instead of a
letter plate. `closeupSubject(focus, line, now)` shows that
speaker instead of the focus while the line is visible and the name differs from the focused NPC,
so the character's sprite, name plate and subtitles slide in even with no NPC in focus. When the
line fades, the close-up goes back to the focused NPC (docked) or goes away. The `pc` class gives
the frame, plate and subtitle bar the accent colour instead of gold.
