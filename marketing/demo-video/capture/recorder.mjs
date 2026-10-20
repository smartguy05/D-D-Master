// CDP screencast recorder: captures every compositor frame with its timestamp, then encodes a
// constant-60fps H.264 MP4 with ffmpeg (each frame held until the next one arrived).
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
export const FOOTAGE_DIR = resolve(here, "../public/footage");
export const WEB = process.env.CAPTURE_WEB ?? "http://localhost:5180";
export const API = process.env.CAPTURE_API ?? "http://localhost:8790";
const FRAMES_ROOT = process.env.CAPTURE_FRAMES ?? join(tmpdir(), "hearthmaster-frames");

// Hardware WebGL in headless Chrome (AMD/Mesa via ANGLE GL-EGL); SwiftShader only manages ~12fps.
const CHROME =
  process.env.CAPTURE_CHROME ?? join(homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome");
const GPU_ARGS = ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--autoplay-policy=no-user-gesture-required"];

export async function launch() {
  return chromium.launch({ executablePath: CHROME, args: GPU_ARGS });
}

export const TV = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

export async function api(path, body) {
  const res = await fetch(API + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

export const tool = (name, args = {}) => api(`/api/tools/${name}`, args);
export const state = () => api("/api/state").catch(() => null);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start recording `page`. Returns { mark(label), stop() }; stop() encodes
 * public/footage/<id>.mp4 and resolves to a shots.json entry.
 */
export async function record(page, id, { width, height } = {}) {
  const vp = page.viewportSize();
  const scale = await page.evaluate(() => window.devicePixelRatio);
  const outW = width ?? Math.round(vp.width * scale);
  const outH = height ?? Math.round(vp.height * scale);
  const dir = join(FRAMES_ROOT, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  const marks = [];
  let t0 = null;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    const ts = metadata.timestamp;
    if (t0 === null) t0 = ts;
    const file = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
    frames.push({ file, ts });
    writes.push(writeFile(file, Buffer.from(data, "base64")));
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: outW, maxHeight: outH, everyNthFrame: 1 });
  const wall0 = Date.now() / 1000;
  return {
    /** Mark a highlight at "now" (seconds from the first frame). */
    mark(label) {
      marks.push({ tSec: +((Date.now() / 1000) - (t0 ?? wall0)).toFixed(2), label });
    },
    /** Stop without encoding (a take we don't keep). */
    async discard() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    },
    async stop() {
      // Screencast frames only arrive when the page changes; hold the last one until "now".
      const endTs = epochClock(t0, wall0) ? Date.now() / 1000 : null;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      return encode(id, frames, marks, outW, outH, endTs);
    },
  };
}

// CDP frame timestamps are epoch seconds; marks and the tail hold rely on that.
const epochClock = (ts, wall) => ts !== null && Math.abs(ts - wall) < 30;

function encode(id, frames, marks, w, h, endTs) {
  if (frames.length < 2) throw new Error(`${id}: only ${frames.length} frames captured`);
  const t0 = frames[0].ts;
  const durationSec = +((endTs ?? frames.at(-1).ts) - t0).toFixed(2);
  // Persist the frame timing so a shot can be re-encoded later (reencode.mjs).
  writeFileSync(join(dirname(frames[0].file), "timing.json"), JSON.stringify({ id, w, h, endTs, frames, marks }));
  encodeCfr(id, frames, w, h, durationSec);
  const sourceFps = +((frames.length - 1) / Math.max(frames.at(-1).ts - t0, 0.001)).toFixed(1);
  console.log(`[rec] ${id}: ${frames.length} frames, ${durationSec}s, source ~${sourceFps} fps`);
  return { id, file: `footage/${id}.mp4`, width: w, height: h, fps: 60, sourceFps, durationSec, highlights: marks };
}

/**
 * Exact constant 60fps: output frame k shows the newest captured frame at t0 + k/60, laid out as
 * a numbered symlink sequence (no concat-demuxer duration rounding). TV-range yuv420p output.
 */
export function encodeCfr(id, frames, w, h, durationSec) {
  const seq = join(dirname(frames[0].file), "cfr");
  rmSync(seq, { recursive: true, force: true });
  mkdirSync(seq);
  const t0 = frames[0].ts;
  const n = Math.max(1, Math.round(durationSec * 60));
  for (let k = 0, i = 0; k < n; k++) {
    const t = t0 + k / 60;
    while (i + 1 < frames.length && frames[i + 1].ts <= t + 1e-6) i++;
    symlinkSync(frames[i].file, join(seq, `${String(k).padStart(6, "0")}.jpg`));
  }
  mkdirSync(FOOTAGE_DIR, { recursive: true });
  const out = join(FOOTAGE_DIR, `${id}.mp4`);
  const r = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-framerate", "60", "-i", join(seq, "%06d.jpg"),
    "-vf", `scale=${w}:${h}:flags=lanczos:in_range=full:out_range=tv,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-r", "60",
    "-color_range", "tv", "-movflags", "+faststart", out,
  ], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${id}`);
  rmSync(seq, { recursive: true, force: true });
  return out;
}

/** Merge entries into public/footage/shots.json (replacing same ids). */
export async function saveShots(entries) {
  const file = join(FOOTAGE_DIR, "shots.json");
  let all = [];
  if (existsSync(file)) all = JSON.parse((await import("node:fs")).readFileSync(file, "utf8"));
  for (const e of entries) all = [...all.filter((x) => x.id !== e.id), e];
  all.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
}
