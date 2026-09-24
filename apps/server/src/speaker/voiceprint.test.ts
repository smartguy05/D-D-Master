import { describe, expect, it } from "vitest";
import { cosine, matchSpeaker, mergeEmbedding } from "./voiceprint.js";
import { AudioRing, SAMPLE_RATE, trimSilence } from "./audio.js";

const v = (...xs: number[]) => Float32Array.from(xs);

describe("voiceprint math", () => {
  it("matches the closest enrolled voice", () => {
    const prints = [
      { playerId: "sam", embedding: v(1, 0, 0), samples: 1 },
      { playerId: "alex", embedding: v(0, 1, 0), samples: 1 },
    ];
    const m = matchSpeaker(v(0.9, 0.1, 0), prints, 0.5)!;
    expect(m.playerId).toBe("sam");
    expect(m.confident).toBe(true);
  });

  it("is not confident when two voices are nearly tied or below threshold", () => {
    const prints = [
      { playerId: "sam", embedding: v(1, 0), samples: 1 },
      { playerId: "alex", embedding: v(0.98, 0.2), samples: 1 },
    ];
    expect(matchSpeaker(v(1, 0.1), prints, 0.5)!.confident).toBe(false);
    expect(matchSpeaker(v(0, 1), [prints[0]], 0.5)!.confident).toBe(false);
  });

  it("running mean moves toward new samples", () => {
    const a = mergeEmbedding(undefined, 0, v(1, 0));
    const b = mergeEmbedding(a, 1, v(0, 1));
    expect(cosine(b, v(1, 1))).toBeCloseTo(1, 5);
  });
});

describe("AudioRing", () => {
  it("slices by timestamp", () => {
    const ring = new AudioRing(2);
    const t0 = 10_000;
    const second = new Float32Array(SAMPLE_RATE).fill(0.5);
    ring.push(second, t0 + 1000);
    ring.push(new Float32Array(SAMPLE_RATE).fill(-0.5), t0 + 2000);
    const s = ring.slice(t0 + 1500, t0 + 2000);
    expect(s.length).toBe(SAMPLE_RATE / 2);
    expect(s[0]).toBe(-0.5);
    const s2 = ring.slice(t0 + 500, t0 + 1000);
    expect(s2.length).toBe(SAMPLE_RATE / 2);
    expect(s2[0]).toBe(0.5);
  });

  it("trims silence", () => {
    const x = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < SAMPLE_RATE / 2; i++) x[i] = Math.sin(i / 5) * 0.5;
    expect(trimSilence(x).length).toBeLessThan(SAMPLE_RATE * 0.6);
  });
});
