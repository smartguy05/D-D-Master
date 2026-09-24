import type { DiceImpact } from "./simulate";

/**
 * Synthesized dice clatter (WebAudio, no audio files). Each recorded collision plays a short
 * filtered noise burst: bright and short for die-on-die clicks, lower with a small thud for the
 * wooden table. Mute state is per-browser (localStorage), toggled on /table with "M".
 */

const MUTE_KEY = "dm.table.muted";
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = readMuted();
const listeners = new Set<(m: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* storage blocked: mute only lasts for this page */
  }
  listeners.forEach((fn) => fn(m));
  if (!m) void audio()?.resume();
}

export function onMuteChange(fn: (m: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  const len = Math.floor(ctx.sampleRate * 0.25);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Browsers start audio suspended until a user gesture; call from any key/click handler. */
export function unlockAudio() {
  const a = audio();
  if (a && a.state === "suspended") void a.resume();
}

/** Play one collision click. `when` is an offset in seconds from now. */
export function playImpact(imp: Pick<DiceImpact, "strength" | "surface">, when = 0) {
  if (muted) return;
  const a = audio();
  if (!a || !noise || a.state !== "running") return;
  const t = a.currentTime + when;
  const vol = Math.min(0.9, 0.08 + imp.strength * 0.8);
  const die = imp.surface === "die";

  const src = a.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const band = a.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = die ? 3200 + Math.random() * 2400 : 1500 + Math.random() * 900;
  band.Q.value = die ? 6 : 2.5;
  const gain = a.createGain();
  const decay = die ? 0.035 : 0.06 + imp.strength * 0.04;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(band).connect(gain).connect(a.destination);
  src.start(t, Math.random() * 0.15, decay + 0.02);

  if (!die && imp.strength > 0.25) {
    // low wooden thud under hard table hits
    const osc = a.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180 + Math.random() * 40, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const g = a.createGain();
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(a.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}
