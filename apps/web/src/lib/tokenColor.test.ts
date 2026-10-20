import { describe, expect, it } from "vitest";
import * as tc from "./tokenColor";
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

describe("attitude colours (Phase 4)", () => {
  const color = monsterColor as (m: Record<string, unknown>) => string;
  const byAttitude = (tc as unknown as { attitudeColor: (a: string) => string }).attitudeColor;

  it("attitudeColor: hostile red, indifferent amber, friendly green", () => {
    expect(byAttitude("hostile")).toBe("#c0392b");
    expect(byAttitude("indifferent")).toBe("#e0a030");
    expect(byAttitude("friendly")).toBe("#4caf50");
  });

  it("monsterColor follows the stored attitude / score", () => {
    expect(color({ ally: false, neutral: false, attitudeScore: 4 })).toBe("#4caf50");
    expect(color({ ally: false, neutral: false, attitudeScore: -1 })).toBe("#e0a030");
    expect(color({ ally: true, neutral: false, attitude: "hostile", attitudeScore: -3 })).toBe("#c0392b");
    expect(color({ attitude: "friendly" })).toBe("#4caf50");
  });

  it("old monsters without attitude fields keep their disposition colour", () => {
    expect(color({ ally: true, neutral: false })).toBe("#4caf50");
    expect(color({ ally: false, neutral: true })).toBe("#e0a030");
    expect(color({ ally: false, neutral: false })).toBe("#c0392b");
  });
});
