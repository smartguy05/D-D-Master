# Live footage capture

Records the shot list in `../BRIEF.md` from a live, isolated game session into
`../public/footage/*.mp4` (constant 60fps H.264) plus `shots.json` (highlight timestamps).

1. Copy the data so the real campaigns are never touched: `dm.sqlite` via the sqlite3 backup API,
   plus `campaigns/cmp_cbe6567b3b/`, into a scratch dir.
2. Start an isolated server and Vite (the user's dev servers on :8787/:5173 stay untouched):
   - `cd apps/server && PORT=8790 DATA_DIR=<scratch> npx tsx --env-file-if-exists=../../.env src/index.ts`
   - `cd apps/web && PORT=8790 npx vite --port 5180 --strictPort`
   - `curl -X POST localhost:8790/api/campaigns/cmp_cbe6567b3b/load -H 'content-type: application/json' -d '{}'`
3. `npm install` here, then run the takes in order (each uses the live text-mode DM, which costs OpenAI calls):
   `take-a-docks.mjs` (host-start, voice-talking), `take-b-caves.mjs npc` (npc-closeup),
   `take-b2-fog.mjs` (map-fog), `take-c-combat.mjs` (starts the kobold fight),
   `take-c2-clash.mjs` (combat-turn, phone-sheet, hook-dice), `take-d-walkthrough.mjs`,
   `take-e-host.mjs` (host-start retake).

Recording uses headless Chrome with the hardware GPU (ANGLE GL-EGL; SwiftShader only reaches about 12fps)
and CDP screencast frames with timestamps. `recorder.mjs` maps them onto an exact 60fps grid.
`reencode.mjs` rebuilds the MP4s from the saved frames in `$TMPDIR/hearthmaster-frames/`.

## v2 takes (the Tour cut, 2026-10-21)

Copy `dm.sqlite` plus every campaign folder the takes use. Then run `node setup-v2.mjs` (Pip to the
roster, lighthouse walls and doors) and the takes in this order: `take-v2-light.mjs sprites doors`,
`take-v2-crit.mjs`, `take-v2-victory.mjs`, `take-v2-light.mjs loot phone`, `take-v2-npc.mjs`,
`take-v2-host.mjs`, `take-v2-ai.mjs ai split`. `dump.mjs` prints the live state ids. Each take with
dialog writes `public/footage/<id>.dialog.json`. `cam.mjs` drives the TV camera.
