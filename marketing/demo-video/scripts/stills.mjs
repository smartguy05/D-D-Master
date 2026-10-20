// Renders one frame per bar (on beat 3 of each bar, when that bar's caption is up) into
// out/frames/, then tiles them into out/contact-sheet.png for review.
// Usage: node scripts/stills.mjs [--beat=2.5] [--composition=Demo]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const beatInBar = parseFloat(arg("beat", "3"));
const compositionId = arg("composition", "Demo");

const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const composition = await selectComposition({ serveUrl, id: compositionId, inputProps: {} });
const bpm = composition.props.bpm;
const fpb = (composition.fps * 60) / bpm;
const outDir = path.join(root, "out/frames");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// --frames=0,45,100 renders just those frames to out/frames/frame-N.png (no contact sheet).
const only = arg("frames", "");
if (only) {
  for (const fr of only.split(",").map(Number)) {
    await renderStill({ composition, serveUrl, output: path.join(outDir, `frame-${fr}.png`), frame: fr, inputProps: composition.props });
    console.log(`frame ${fr}`);
  }
  process.exit(0);
}

const bars = Math.round(composition.durationInFrames / (fpb * 4));
for (let b = 0; b < bars; b++) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round((b * 4 + beatInBar) * fpb));
  const output = path.join(outDir, `bar-${String(b + 1).padStart(2, "0")}.png`);
  await renderStill({ composition, serveUrl, output, frame, inputProps: composition.props });
  console.log(`bar ${b + 1} → frame ${frame}`);
}

execFileSync("ffmpeg", [
  "-loglevel", "error", "-y",
  "-pattern_type", "glob", "-i", path.join(outDir, "bar-*.png"),
  "-vf", "scale=640:-1,tile=5x3:padding=8:color=0x120d0a",
  "-frames:v", "1",
  path.join(root, "out/contact-sheet.png"),
]);
console.log(`bpm ${bpm}, ${composition.durationInFrames} frames → out/contact-sheet.png`);
