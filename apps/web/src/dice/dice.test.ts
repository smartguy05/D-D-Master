import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { defaultLabels, dieShape, faceCount, topIndex, type DieKind } from "./shapes";
import { simulateThrow, toVisualDice } from "./simulate";

const KINDS: DieKind[] = ["d4", "d6", "d8", "d10", "d12", "d20"];

function landedValue(die: ReturnType<typeof simulateThrow>[number]) {
  const o = die.frames.length - 7;
  const q = new THREE.Quaternion(die.frames[o + 3], die.frames[o + 4], die.frames[o + 5], die.frames[o + 6]);
  return die.labels[topIndex(dieShape(die.kind), q)];
}

describe("dice shapes", () => {
  it.each(KINDS)("%s has the right number of faces and a full label set", (kind) => {
    const s = dieShape(kind);
    expect(s.readVertex ? s.vertices.length : s.faces.length).toBe(faceCount(kind));
    expect([...defaultLabels(s)].sort((a, b) => a - b)).toEqual([...Array(faceCount(kind))].map((_, i) => i + 1));
  });

  it("d10 kites are planar", () => {
    const s = dieShape("d10");
    for (const [fi, face] of s.faces.entries()) {
      const p0 = s.vertices[face[0]];
      for (const vi of face) expect(Math.abs(s.vertices[vi].clone().sub(p0).dot(s.normals[fi]))).toBeLessThan(1e-6);
    }
  });
});

describe("simulated throws always show the server result", () => {
  it.each(KINDS)("%s lands on every requested value", (kind) => {
    for (let v = 1; v <= faceCount(kind); v++) {
      const [die] = simulateThrow([{ kind, target: v, style: "plain", dropped: false }], (v * 7919) % 1000 / 1000 + 0.001);
      expect(landedValue(die)).toBe(v);
      expect(die.frames[die.frames.length - 6]).toBeGreaterThan(0); // resting above the floor
    }
  });

  it("maps d100 to percentile + ones dice", () => {
    expect(toVisualDice([{ sides: 100, value: 100 }]).map((d) => d.target)).toEqual([10, 10]);
    expect(toVisualDice([{ sides: 100, value: 37 }]).map((d) => [d.style, d.target])).toEqual([["percentile", 3], ["d10", 7]]);
    expect(toVisualDice([{ sides: 3, value: 2 }])).toEqual([]);
  });

  it("throws many dice at once", () => {
    const dice = toVisualDice(Array.from({ length: 8 }, (_, i) => ({ sides: 6, value: (i % 6) + 1 })));
    const sim = simulateThrow(dice, 0.42);
    sim.forEach((d, i) => expect(landedValue(d)).toBe(dice[i].target));
  });
});
