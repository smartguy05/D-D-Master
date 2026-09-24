import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { defaultLabels, dieShape, faceCount, topIndex, type DieKind } from "./shapes";
import { impactSchedule, simulateThrow, toVisualDice } from "./simulate";

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

describe("collision recording for dice sounds", () => {
  it("records impacts inside the recorded frames", () => {
    const sim = simulateThrow(toVisualDice([{ sides: 20, value: 17 }, { sides: 6, value: 3 }, { sides: 8, value: 5 }]), 0.3);
    for (const d of sim) {
      const frameCount = d.frames.length / 7;
      expect(d.impacts.length).toBeGreaterThan(0); // every thrown die hits the table at least once
      for (const imp of d.impacts) {
        expect(imp.frame).toBeGreaterThanOrEqual(0);
        expect(imp.frame).toBeLessThan(frameCount);
        expect(imp.strength).toBeGreaterThan(0);
        expect(imp.strength).toBeLessThanOrEqual(1);
      }
      // frames strictly increase and respect the per-die gap
      d.impacts.slice(1).forEach((imp, i) => expect(imp.frame - d.impacts[i].frame).toBeGreaterThanOrEqual(3));
    }
    // dice at rest make no noise: nothing in the last 10 frames
    const last = Math.max(...sim.map((d) => d.frames.length / 7));
    expect(sim.flatMap((d) => d.impacts).every((imp) => imp.frame < last - 10)).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const a = simulateThrow(toVisualDice([{ sides: 12, value: 4 }]), 0.77);
    const b = simulateThrow(toVisualDice([{ sides: 12, value: 4 }]), 0.77);
    expect(a[0].impacts).toEqual(b[0].impacts);
  });

  it("merges impacts into a sorted schedule capped per frame", () => {
    const sched = impactSchedule(
      [
        { impacts: [{ frame: 5, strength: 0.2, surface: "table" }, { frame: 9, strength: 0.5, surface: "die" }] },
        { impacts: [{ frame: 5, strength: 0.9, surface: "table" }, { frame: 5, strength: 0.1, surface: "table" }] },
        { impacts: [{ frame: 2, strength: 0.4, surface: "table" }, { frame: 5, strength: 0.3, surface: "die" }] },
      ],
      2,
    );
    expect(sched.map((i) => [i.frame, i.strength])).toEqual([
      [2, 0.4],
      [5, 0.9],
      [5, 0.3],
      [9, 0.5],
    ]);
  });
});
