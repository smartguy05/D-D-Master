# Feature: Table (TV) display
Status: done (vertical slice)
Docs: docs/web/table-display.md

## Overview
`/table`: a 3D map board (AI map texture + grid) with billboard sprite tokens, a party sidebar
(HP, AC, conditions, inventory, gold), foes list, initiative strip, DM status orb, speaker
highlight, physical-roll banner, dice overlay and toast.

## Notes
- Fog only renders when the location has an *enabled* fog entry. `change_scene` creates one on
  the first visit to a `Location.fog` location; saves that already have a disabled entry need the
  host Board toggle.
- Feature consumers must use `effectiveFeatures(state, loc)` (shared), never `loc.features`
  directly; the engine gets it through `currentGrid`.
- Host board edits are one tool call per drop (pointerup), so each is one undo step.
- FitCamera computes the distance from the fov and aspect ratio. The earlier heuristic cut off the
  left columns.
- Billboards face the camera fully. With `lockX/lockZ` they looked squashed from the steep camera.
- Fog renders first among transparent objects (renderOrder -1); see bugs/fog-hides-effects.md.
- Headless screenshots (swiftshader) run at a few FPS; effect animations use `min(dt, 0.1)` so they
  play slower there, and a screenshot takes a few hundred ms. Take shots ~150-400 ms after the call.
- Effects are transient `effect` events, not state; a table that connects later does not replay them.
- Attack/spell animations: the server picks style/element/outcome (engine/effects.ts); the TV picks
  timing (effectPlan.ts). The travel dedupe (same source→target within 1.5 s) lives on the TV because
  the engine has no clock. MapBoard caches each effect's plan by id: recomputing it every render
  would let the dedupe flip when the earlier effect expires and start a travel ~2 s late.
- Area radius approximations: cube/cone = a circle of half their size, line = half its width (a
  line with targets flies an orb to each target instead). Documented in the tool catalog.
- Headless smoke (2026-10-18, swiftshader): orbs+trails, Magic Missile darts, Fireball ring+sphere
  and the miss dust all render, no console errors; timings lag far behind real time there.

## TODOs
- [ ] Real line of sight: needs wall/door data (map editing) and a shadowcast over the grid
- [ ] Optional darkness vignette outside torchlight in dim locations (lights dim to 60% today)
- [ ] Live check of attack/spell animation timing and sound levels on the real TV (headless is too slow to judge)
- [ ] Physical attack rolls: optional `natural` arg on record_physical_roll for crit/fumble animations
- [ ] Map editing of walls/doors (line of sight); token drag is done (host Board tab)
- [ ] Board tab: optional live-drag preview on the TV (today the TV moves on drop only)

## Completed
- 2026-10-20: Orb shows Muted while the table mic is muted (`table/orb.ts`); neutral creatures amber and on neither list; knocked-out allies; 💥 physical damage prompt.
- 2026-10-19: Fog shows on first arrival at any `fog: true` location (no set_fog needed).
- 2026-10-19: NPC dialogue close-up: `npc_focus` tool (+ speak_as_npc) → portrait slides in with
  paced subtitles from the DM's transcript (`caption` events), docked between lines; cleared by the
  DM, a scene change or 60 s idle. Answers to the old open questions: the DM signals the NPC with
  `npc_focus` (one fast tool round-trip) and the close-up lasts the whole conversation.
- 2026-10-19: Crit/fumble flourish, join QR (Q), live who's-talking pulse + level bar, effects
  wait for the dice tray (bug attack-anim-before-damage-dice).
- 2026-10-19: Closed "Player phone view" here: shipped as its own feature (see features/player-view.md).
- 2026-10-18: Automatic attack and spell animations (TODO item 7): `attack`/`area` effect kinds
  and `style`/`outcome`/`label`/`count`/`shape` on BoardEffect; attack rolls with `target_id`
  (also physical via pendingRoll), `apply_damage` `source_id`, `cast_spell` orbs/darts/areas/
  bursts/heal/arcane; Swing, Arrow, SpellOrb, AreaRing recipes; hit/crit/miss(dodge)/heal token
  reactions at impact time; synthesized effect sounds in `dice/sound.ts` (respect mute); persona line.
- 2026-10-18: Host **Board** tab (`apps/web/src/host/board/`): 2D SVG grid over the painted map;
  drag tokens (`move_token`), drag-rectangle fog reveal/hide (`edit_fog`, host-only), fog on/off/
  reset, feature select/move/resize/add/delete with kind/lit/blocks (`edit_map_feature`,
  host-only, stored in `state.featureEdits` keyed to `mapUrl` so a repaint resets it), monster
  hide/show/remove (`set_monster_hidden`, also a DM tool for ambushes). `LocationFog.hidden` cells
  are never auto-revealed; the TV uses `revealedSet`. `MapFeature.blocks` read by the vision model
  (spawn placement that uses it is stream E).
- 2026-10-18 (review round 1): TV visibility in one tested helper (`table/visibility.ts`): hidden
  monsters left out of tokens, foes, initiative strip and effects; hidden monsters still act in
  combat. Repaint always paints fresh and resets Board edits (bugs/repaint-keeps-board-edits.md).
- 2026-10-18 (review round 2): `rollForTable` anonymizes hidden monsters' dice rolls on the TV;
  first paint keeps fog; generateMap safe across campaign switches (bugs/generate-map-wrong-campaign.md).
- 2026-09-24: Fog of war (per-location revealed cells, reveal_area/set_fog, auto-reveal around
  characters by light radius, 3D displaced smoke shroud with smooth fade, monsters in fog hidden from
  map, foes list and initiative strip).
- 2026-09-24: Light radius (Character.lightRadius, default 6) with flickering torch point lights
  when fog is on. Line of sight is radius-only (no walls yet).
- 2026-09-24: Board effects (effect event + play_effect tool; hit/crit/miss/heal automatic):
  slash arcs, fireball sphere + light, lightning tube bolts, frost shards, poison cloud, radiant
  pillar, necrotic swirl, thunder rings, arcane burst, heal sparkles; token shake + color flash.
- 2026-09-24: Board, tokens, HUD, initiative, inventory, speaker glow, jobs.
- 2026-10-18: PartyCard shows death-save pips while dying, a Stable badge and a concentration badge;
  only Dead cards are fully greyed (rules UI, stream D).
- 2026-10-18: Allies (add_npc): green token ring, green initiative entry, own list; followers shown in
  fog (see bugs/following-npc-has-no-token.md).
