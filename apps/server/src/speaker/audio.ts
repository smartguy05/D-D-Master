/**
 * Rolling buffer of the host microphone (16 kHz mono float), timestamped with server
 * wall-clock time so we can cut out "the audio of the turn that just ended".
 */
export const SAMPLE_RATE = 16000;

export class AudioRing {
  private buf: Float32Array;
  private write = 0;
  private filled = 0;
  /** Server time (ms) of the sample just before `write`. */
  private endTs = 0;

  constructor(readonly seconds = 60) {
    this.buf = new Float32Array(SAMPLE_RATE * seconds);
  }

  /** Append PCM16 little-endian samples that ended at `ts` (defaults to now). */
  pushPcm16(chunk: Buffer, ts = Date.now()) {
    const n = Math.floor(chunk.length / 2);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = chunk.readInt16LE(i * 2) / 32768;
    this.push(f, ts);
  }

  push(samples: Float32Array, ts = Date.now()) {
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.write] = samples[i];
      this.write = (this.write + 1) % this.buf.length;
    }
    this.filled = Math.min(this.buf.length, this.filled + samples.length);
    this.endTs = ts;
  }

  get lastTs() {
    return this.endTs;
  }

  /** Samples between two server timestamps (clamped to what is buffered). */
  slice(fromTs: number, toTs: number): Float32Array {
    if (!this.filled || toTs <= fromTs) return new Float32Array(0);
    const msPerSample = 1000 / SAMPLE_RATE;
    const endBack = Math.max(0, Math.round((this.endTs - toTs) / msPerSample));
    const startBack = Math.min(this.filled, Math.round((this.endTs - fromTs) / msPerSample));
    if (startBack <= endBack) return new Float32Array(0);
    const len = startBack - endBack;
    const out = new Float32Array(len);
    const start = (this.write - startBack + this.buf.length * 2) % this.buf.length;
    for (let i = 0; i < len; i++) out[i] = this.buf[(start + i) % this.buf.length];
    return out;
  }
}

/** Keep only 30 ms frames louder than a noise floor, so silence doesn't dilute the voiceprint. */
export function trimSilence(samples: Float32Array, rel = 0.12): Float32Array {
  const frame = Math.round(SAMPLE_RATE * 0.03);
  const energies: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let e = 0;
    for (let j = 0; j < frame; j++) e += samples[i + j] ** 2;
    energies.push(Math.sqrt(e / frame));
  }
  if (!energies.length) return samples;
  const peak = Math.max(...energies);
  const floor = Math.max(0.005, peak * rel);
  const keep: number[] = [];
  energies.forEach((e, idx) => {
    if (e >= floor) keep.push(idx);
  });
  const out = new Float32Array(keep.length * frame);
  keep.forEach((idx, k) => out.set(samples.subarray(idx * frame, idx * frame + frame), k * frame));
  return out;
}
