// Builds public/voice/<id>.mp3 + manifest.json from voice/script.json: narrator, DM and player
// lines through the OpenAI speech API (OPENAI_API_KEY from the repo .env), NPC/AI clips copied
// from the capture data dir (VOICE_CLIPS_DIR, the campaign's assets folder). Existing files are
// kept unless their text changed (or --force).
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public/voice");
const script = JSON.parse(readFileSync(join(root, "voice/script.json"), "utf8"));
const force = process.argv.includes("--force");
const env = Object.fromEntries(
  readFileSync(resolve(root, "../../.env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const key = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
const model = env.NPC_TTS_MODEL || "gpt-4o-mini-tts";
mkdirSync(out, { recursive: true });
const manifestFile = join(out, "manifest.json");
const old = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { lines: [] };

const duration = (file) =>
  +spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();

const lines = [];
for (const l of script.lines) {
  const file = join(out, `${l.id}.mp3`);
  const prev = old.lines.find((x) => x.id === l.id);
  if (force || !existsSync(file) || prev?.text !== l.text) {
    if (l.role === "clip") {
      copyFileSync(join(process.env.VOICE_CLIPS_DIR ?? "", l.src), file);
    } else {
      const v = script.voices[l.role];
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, voice: v.voice, input: l.text, instructions: v.instructions, response_format: "mp3" }),
      });
      if (!res.ok) throw new Error(`${l.id}: ${res.status} ${await res.text()}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    // Trim lead/tail silence and level every line to the same loudness.
    const tmp = file.replace(/\.mp3$/, ".raw.mp3");
    copyFileSync(file, tmp);
    const trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse";
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-af", `${trim},loudnorm=I=-16:TP=-1.5:LRA=11`, "-ar", "48000", "-b:a", "192k", file]);
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${l.id}`);
    rmSync(tmp);
    console.log("made", l.id);
  }
  lines.push({ id: l.id, role: l.role, text: l.text, file: `voice/${l.id}.mp3`, durationSec: +duration(file).toFixed(2) });
}
writeFileSync(manifestFile, JSON.stringify({ lines }, null, 2) + "\n");
console.log(lines.map((l) => `${l.id.padEnd(12)} ${l.durationSec}s`).join("\n"));
