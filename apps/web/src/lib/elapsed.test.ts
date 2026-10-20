import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_725_000)).toBe("62:05");
  });

  it("rounds down partial seconds and clamps negatives to 0:00", () => {
    expect(formatElapsed(59_999)).toBe("0:59");
    expect(formatElapsed(-500)).toBe("0:00");
  });
});
