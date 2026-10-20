// Re-encode shots from captured frames (timing.json, or list.txt from older captures) with the
// current encoder. Usage: node reencode.mjs [id ...]   (default: every shot in shots.json)
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeCfr, FOOTAGE_DIR } from "./recorder.mjs";

const root = process.env.CAPTURE_FRAMES ?? join(tmpdir(), "hearthmaster-frames");
const shotsFile = join(FOOTAGE_DIR, "shots.json");
const shots = JSON.parse(readFileSync(shotsFile, "utf8"));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : shots.map((s) => s.id);
for (const id of ids) {
  const dir = join(root, id);
  let frames, durationSec;
  if (existsSync(join(dir, "timing.json"))) {
    const t = JSON.parse(readFileSync(join(dir, "timing.json"), "utf8"));
    frames = t.frames;
    durationSec = (t.endTs ?? frames.at(-1).ts) - frames[0].ts;
  } else {
    // list.txt: "file '<path>'" / "duration <s>" pairs; the last duration runs to the stop time.
    const lines = readFileSync(join(dir, "list.txt"), "utf8").trim().split("\n");
    frames = [];
    let t = 0;
    for (let i = 0; i + 1 < lines.length; i += 2) {
      frames.push({ file: lines[i].slice(6, -1), ts: t });
      t += parseFloat(lines[i + 1].split(" ")[1]);
    }
    durationSec = t;
  }
  const s = shots.find((x) => x.id === id);
  encodeCfr(id, frames, s.width, s.height, durationSec);
  s.durationSec = +durationSec.toFixed(2);
  console.log(`[reencode] ${id}: ${frames.length} frames → ${s.durationSec}s`);
}
writeFileSync(shotsFile, JSON.stringify(shots, null, 2) + "\n");
