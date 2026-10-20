import { describe, expect, it } from "vitest";
import { attitudeBadge } from "./attitudeBadge";

describe("attitudeBadge", () => {
  it("shows the stored attitude and signed score", () => {
    expect(attitudeBadge({ attitude: "friendly", attitudeScore: 4 })).toBe("🙂 Friendly +4");
    expect(attitudeBadge({ attitude: "hostile", attitudeScore: -5 })).toBe("😠 Hostile −5");
    expect(attitudeBadge({ attitudeScore: 0 })).toBe("😐 Indifferent 0");
  });

  it("derives from disposition flags for old saves", () => {
    expect(attitudeBadge({ ally: true })).toBe("🙂 Friendly +3");
    expect(attitudeBadge({ neutral: true })).toBe("😐 Indifferent 0");
    expect(attitudeBadge({})).toBe("😠 Hostile −3");
  });

  it("derives the attitude from a lone score by thresholds", () => {
    expect(attitudeBadge({ attitudeScore: -2 })).toBe("😐 Indifferent −2");
    expect(attitudeBadge({ attitudeScore: 3 })).toBe("🙂 Friendly +3");
  });
});
