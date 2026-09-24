import { describe, expect, it } from "vitest";
import { naturalD20, parseNotation, rollNotation, type Rng } from "./dice.js";

const fixed =
  (...values: number[]): Rng =>
  () => {
    const v = values.shift();
    if (v === undefined) throw new Error("rng exhausted");
    return v;
  };

describe("parseNotation", () => {
  it("parses dice and modifiers", () => {
    expect(parseNotation("2d6 + 1d4 - 1")).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 6 },
      { kind: "dice", sign: 1, count: 1, sides: 4 },
      { kind: "mod", sign: -1, value: 1 },
    ]);
  });
  it("handles implicit count, d% and keep", () => {
    expect(parseNotation("d20")[0]).toMatchObject({ count: 1, sides: 20 });
    expect(parseNotation("d%")[0]).toMatchObject({ sides: 100 });
    expect(parseNotation("2d20kh1")[0]).toMatchObject({ keep: { mode: "h", n: 1 } });
  });
  it("rejects garbage", () => {
    expect(() => parseNotation("")).toThrow();
    expect(() => parseNotation("2x6")).toThrow();
    expect(() => parseNotation("1d20kh3")).toThrow();
    expect(() => parseNotation("1d1")).toThrow();
  });
});

describe("rollNotation", () => {
  it("sums dice and modifier", () => {
    const r = rollNotation("2d6+3", fixed(4, 5));
    expect(r.total).toBe(12);
    expect(r.modifier).toBe(3);
    expect(r.dice.map((d) => d.value)).toEqual([4, 5]);
  });
  it("keeps highest for advantage", () => {
    const r = rollNotation("2d20kh1+2", fixed(7, 15));
    expect(r.total).toBe(17);
    expect(r.dice[0].dropped).toBe(true);
    expect(naturalD20(r.dice)).toBe(15);
  });
  it("keeps lowest for disadvantage", () => {
    const r = rollNotation("2d20kl1", fixed(7, 15));
    expect(r.total).toBe(7);
  });
  it("stays within bounds with the default rng", () => {
    for (let i = 0; i < 500; i++) {
      const r = rollNotation("1d20");
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(20);
    }
  });
});
