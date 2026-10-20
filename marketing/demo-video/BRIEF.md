# Hearthmaster demo video: production brief

Shared contract for the agents building the ~30s demo video. The creative spec is below
("Creative spec"); the file and timing contract that ties the parts together is first.

## Contract (all agents)

Root: `marketing/demo-video/` (NOT part of the pnpm workspace; use `npm` here, never `pnpm`).
Do not edit anything under `apps/`, `packages/`, `campaigns/` or the user's running dev servers
(:8787 server, :5173 Vite). Do not commit.

```
marketing/demo-video/
  BRIEF.md                 this file
  package.json, src/       Remotion project (animation agent)
  public/footage/*.mp4     live captures, 1920x1080 (phone shots 1080x1920 or native), CFR 60fps (capture agent)
  public/footage/shots.json  manifest (capture agent), see below
  public/audio/track.(mp3|wav)  chosen music (music agent)
  public/audio/analysis.json    beat grid (music agent), see below
  audio/CREDITS.md         track credit + license terms (music agent)
  audio/candidates/        downloaded candidates (music agent)
  capture/                 capture scripts (capture agent)
  out/                     renders, previews, contact sheets
```

### Shot list (capture agent produces these names; animation agent consumes them)
| id | source view | content |
|---|---|---|
| `hook-dice` | /table | physics dice tumbling and landing, ideally a natural 20 / crit |
| `voice-talking` | /table | live who's-talking indicator / name tag / mic level as players speak |
| `map-fog` | /table | 3D map with tokens, fog of war revealing, camera moving |
| `npc-closeup` | /table | npc_focus dialogue close-up with paced subtitles |
| `combat-turn` | /table | combat: initiative/turn order, an attack, damage, HP change |
| `phone-sheet` | /player/:id | phone character sheet (390x844 viewport, device scale 2+), HP dropping if possible |
| `host-start` | /host | host laptop controls: starting the session / DM |
| `walkthrough` | /table | one continuous 8–12s take: map appears → NPC speaks → attack resolves |

`shots.json`: `[{ "id", "file", "width", "height", "fps", "durationSec", "highlights": [{ "tSec", "label" }] }]`
Highlights mark the useful moments (e.g. `{ "tSec": 3.4, "label": "nat20 lands" }`) so the editor
can trim to them. Capture generous footage (10–30s per shot); the editor trims.

### Audio analysis (`public/audio/analysis.json`)
`{ "file": "track.mp3", "title", "artist", "bpm": 120.0, "downbeatSec": 0.52, "windowStartSec": 31.0,
  "hitSec": 33.0, "endingSec": 61.0, "notes": "..." }`
- `windowStartSec`: where the 30s excerpt starts in the track (must be on a downbeat).
- The video timeline is 15 bars of 4/4 at `bpm`; bar length = 240/bpm seconds.

### Timing (animation agent)
All scene boundaries are expressed in bars/beats and derived from `analysis.json`'s bpm, so a
different track only changes one number. Until the track exists, default to 120 BPM.

## Creative spec

Make a ~30-second, 1920×1080, 60fps product demo video for **Hearthmaster**, an AI Dungeon Master
for in-person 5e tabletop games: a voice DM that runs the table through one shared mic, recognizes
each player by voice, and drives a 3D battle map with physics dice on the TV.

### Footage: use only what exists, no stock or generated imagery, no people
- Real footage captured live from the running app (campaign "Claude Test Run",
  `cmp_cbe6567b3b`, a smuggler's cove under a lighthouse with kobolds in the sea caves; PCs Brienne
  Saltblade (Fighter), Quill Emberwick (Wizard), Sister Morra Tideward (Cleric)).
- Supplementary stills: `docs/table-screenshot.png`, `.playwright-mcp/{table,closeup,crit}.png`,
  maps/sprites in `campaigns/cmp_cbe6567b3b/assets/`. Animate stills with push-ins, never static holds.
- "Room" shots are mockups: real screen captures inside a TV frame on a wooden tabletop, blurred
  foreground props (dice, minis, character sheets) drawn as simple vector/CSS shapes, warm light.
  No human figures. Each room shot is its own swappable scene component.

### Brand
Tokens from `apps/web/src/styles/app.css`: bg #120d0a, panel #1e1612, line #4a3a2c, text #f1e6d0,
muted #a8977e, gold #e0b83c (primary accent), accent #7fe0ff (sparingly, AI/voice moments),
bad #e0463c (damage/crits only). Use the app's --display/--body fonts (see app.css). Never show
"D&D" or "Dungeons & Dragons".

### Style & tone
"A video-game-quality experience that happens around your kitchen table." The screens serve the
people in the room, they don't replace them.
- Tabletop layer: parchment, ink linework, worn leather, candlelight glow, paper grain + vignette.
  Captions in --display like inked map labels, writing on or stamping in. Transitions: page turn,
  map unroll, die tumbling across as a wipe, candle flicker to black.
- RPG video game layer: floating damage numbers, HP bars draining, gold "NATURAL 20" burst,
  turn-order banners, initiative cards snapping in; trailer camera (fast push-ins, orbit, slow-mo
  dice, whoosh on cuts); on-beat SFX (dice clatter, sword hit, level-up chime) under the music.
- In-person layer: TV view inside a TV-on-table mockup; phone sheet in a phone frame on/above the
  table; voice beats with waveform + who's-talking name tags; avoid headsets/controllers/keyboards.
- ~50% room framing, 50% full-screen closeups. Open on the room, end on the room.

### Music
Matches a fantasy tabletop adventure: hybrid epic fantasy, orchestral/folk (strings, horns,
war drums, lute/fiddle, choir welcome) with modern trailer percussion. Tavern-and-dungeon
adventure, not sci-fi. Avoid pure EDM, lo-fi, horror, chiptune. From the YouTube Audio Library,
"Attribution not required" preferred. Target 115–125 BPM, max ±3% stretch.

### Timeline (15 bars; seconds shown at 120 BPM)
- Bars 1–2 (0–4s) HOOK: candlelit tabletop, TV glowing at the end of the table; push into the
  screen as dice land on a natural 20 → crit burst on the musical hit. Caption: "Your DM just rolled in."
- Bars 3–4 (4–8s): voice recognition, "Knows every voice at the table" (waveform + name tags).
- Bars 5–6 (8–12s): 3D map/tokens/fog → NPC close-up, "The map builds itself" / "NPCs that talk back".
- Bars 7–8 (12–16s): combat turn → phone sheet on the table, "Every rule, tracked" /
  "Your sheet, in your pocket", ending on a 1-beat-cut montage.
- Bars 9–12 (16–24s) WALKTHROUGH: host starts session → TV map → NPC speaks → attack resolves → HP
  drops on phone; pull back to the room on the last beat. Caption: "No screens between friends.
  Just one at the end of the table."
- Bars 13–15 (24–30s) END CARD: room fades to parchment; "Hearthmaster" wordmark in gold,
  "Compatible with 5e · SRD 5.2", "Coming soon", CTA "Gather your party." Last bar holds.
Hard cuts on bar lines; caption pops on beats; bar 1 = frame 0 = a musical downbeat.

### Output
H.264 MP4, yuv420p, CRF ~18, AAC 320k, 60fps; peaks ≤ −1 dBTP. Optional 9:16 cut.
