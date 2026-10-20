import { describe, expect, it } from "vitest";
import { dispositionOf, nextDisposition } from "./disposition";

describe("monster disposition button", () => {
  it("reads foe, ally or neutral from the flags", () => {
    expect(dispositionOf({ ally: false, neutral: false })).toBe("foe");
    expect(dispositionOf({ ally: true, neutral: false })).toBe("ally");
    expect(dispositionOf({ ally: false, neutral: true })).toBe("neutral");
  });

  it("cycles foe → ally → neutral → foe", () => {
    expect(nextDisposition({ ally: false, neutral: false })).toBe("ally");
    expect(nextDisposition({ ally: true, neutral: false })).toBe("neutral");
    expect(nextDisposition({ ally: false, neutral: true })).toBe("foe");
  });
});
