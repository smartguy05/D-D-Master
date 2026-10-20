import { describe, expect, it } from "vitest";
import { monsterColor } from "./tokenColor";

describe("monsterColor", () => {
  it("colours allies green, neutrals amber and foes red (the TV's colours)", () => {
    expect(monsterColor({ ally: true, neutral: false })).toBe("#4caf50");
    expect(monsterColor({ ally: false, neutral: true })).toBe("#e0a030");
    expect(monsterColor({ ally: false, neutral: false })).toBe("#c0392b");
  });

  it("treats missing flags as a foe", () => {
    expect(monsterColor({})).toBe("#c0392b");
  });

  it("neutral wins when both flags are somehow set", () => {
    expect(monsterColor({ ally: true, neutral: true })).toBe("#e0a030");
  });
});
