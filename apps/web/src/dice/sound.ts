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

// ---------- board effect sounds (attacks and spells on the TV) ----------

/** Short synthesized sounds for board effects, all built on the same noise buffer + oscillators. */
export type EffectSound = "whoosh" | "whiff" | "twang" | "zap" | "crackle" | "boom" | "clang" | "thud" | "chime";

/** A running audio context, or null when muted / not unlocked yet. */
function live(): AudioContext | null {
  if (muted) return null;
  const a = audio();
  return a && noise && a.state === "running" ? a : null;
}

function noiseBurst(
  a: AudioContext,
  t: number,
  o: { dur: number; vol: number; type: BiquadFilterType; f0: number; f1?: number; q?: number; rate?: number },
) {
  const src = a.createBufferSource();
  src.buffer = noise;
  src.loop = true; // the buffer is 0.25 s; booms are longer
  src.playbackRate.value = o.rate ?? 1;
  const f = a.createBiquadFilter();
  f.type = o.type;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f0, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + Math.min(0.03, o.dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.2);
  src.stop(t + o.dur + 0.02);
}

function tone(a: AudioContext, t: number, o: { dur: number; vol: number; type: OscillatorType; f0: number; f1?: number; attack?: number }) {
  const osc = a.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

const RECIPES: Record<EffectSound, (a: AudioContext, t: number) => void> = {
  // blade swing: band-passed noise sweeping up then fading
  whoosh: (a, t) => noiseBurst(a, t, { dur: 0.28, vol: 0.35, type: "bandpass", f0: 500, f1: 2400, q: 1.2 }),
  // a quieter, higher whiff for a miss
  whiff: (a, t) => noiseBurst(a, t, { dur: 0.2, vol: 0.15, type: "bandpass", f0: 1800, f1: 4000, q: 1.5 }),
  // bowstring: plucked low triangle + a little string noise
  twang: (a, t) => {
    tone(a, t, { dur: 0.22, vol: 0.3, type: "triangle", f0: 220, f1: 140 });
    noiseBurst(a, t, { dur: 0.06, vol: 0.12, type: "highpass", f0: 3000 });
  },
  // spell orb: a rising square chirp
  zap: (a, t) => tone(a, t, { dur: 0.25, vol: 0.12, type: "square", f0: 300, f1: 1400 }),
  // lightning: harsh high noise crackle with a buzz under it
  crackle: (a, t) => {
    noiseBurst(a, t, { dur: 0.35, vol: 0.4, type: "highpass", f0: 2200, q: 0.7, rate: 1.6 });
    tone(a, t, { dur: 0.3, vol: 0.08, type: "sawtooth", f0: 90, f1: 60 });
  },
  // explosion: low-passed noise + falling sine
  boom: (a, t) => {
    noiseBurst(a, t, { dur: 0.7, vol: 0.6, type: "lowpass", f0: 900, f1: 120, q: 0.8 });
    tone(a, t, { dur: 0.5, vol: 0.5, type: "sine", f0: 120, f1: 40 });
  },
  // critical hit: inharmonic metallic partials
  clang: (a, t) => {
    for (const [f, v] of [[523, 0.18], [1307, 0.1], [2093, 0.06]] as const) tone(a, t, { dur: 0.6, vol: v, type: "sine", f0: f });
    noiseBurst(a, t, { dur: 0.08, vol: 0.25, type: "highpass", f0: 2500 });
  },
  // a hit landing
  thud: (a, t) => {
    tone(a, t, { dur: 0.14, vol: 0.35, type: "sine", f0: 160, f1: 60 });
    noiseBurst(a, t, { dur: 0.08, vol: 0.2, type: "lowpass", f0: 1200 });
  },
  // healing / radiant: two soft bell tones
  chime: (a, t) => {
    tone(a, t, { dur: 0.6, vol: 0.12, type: "sine", f0: 880, attack: 0.02 });
    tone(a, t + 0.08, { dur: 0.6, vol: 0.1, type: "sine", f0: 1320, attack: 0.02 });
  },
};

/** Play one board-effect sound `when` seconds from now (no-op when muted or audio is locked). */
export function playEffectSound(name: EffectSound, when = 0) {
  const a = live();
  if (!a) return;
  RECIPES[name](a, a.currentTime + Math.max(0, when));
}

export const playWhoosh = (when = 0) => playEffectSound("whoosh", when);
export const playTwang = (when = 0) => playEffectSound("twang", when);
export const playZap = (when = 0) => playEffectSound("zap", when);
export const playCrackle = (when = 0) => playEffectSound("crackle", when);
export const playBoom = (when = 0) => playEffectSound("boom", when);
export const playClang = (when = 0) => playEffectSound("clang", when);
