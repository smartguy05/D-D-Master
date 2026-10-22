// Saves what was said during a take (DM replies, player lines, NPC/AI clips) with times relative
// to the take, so the edit can voice the DM and play the NPC clips: public/footage/<id>.dialog.json
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FOOTAGE_DIR } from "./recorder.mjs";

export function dialogTracker(live) {
  const t0 = Date.now();
  return (id) => {
    const rel = (t) => +((t - t0) / 1000).toFixed(2);
    const lines = live.logs.filter((e) => e.t >= t0).map((e) => ({ tSec: rel(e.t), kind: e.kind, speaker: e.speaker ?? null, text: e.text }));
    const clips = (live.npcSpeech ?? []).filter((e) => e.t >= t0).map((e) => ({ tSec: rel(e.t), name: e.npcName, line: e.line, url: e.url, pc: !!e.pc }));
    writeFileSync(join(FOOTAGE_DIR, `${id}.dialog.json`), JSON.stringify({ id, lines, clips }, null, 2) + "\n");
    return { lines, clips };
  };
}
