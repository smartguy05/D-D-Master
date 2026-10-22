import { describe, expect, it } from "vitest";
import { SAY_MAX, sayText } from "./say.js";

describe("sayText (typed input to the DM)", () => {
  it("trims and collapses blank input to nothing", () => {
    expect(sayText("  I open the door \n")).toBe("I open the door");
    expect(sayText("   ")).toBeUndefined();
  });

  it("caps very long input", () => {
    expect(sayText("x".repeat(SAY_MAX + 50))).toHaveLength(SAY_MAX);
  });

  it("ignores anything that isn't a string", () => {
    expect(sayText(undefined)).toBeUndefined();
    expect(sayText({ toString: () => "hi" })).toBeUndefined();
  });
});
