import { describe, expect, it } from "vitest";
import { buildMapPrompt } from "./index.js";

describe("buildMapPrompt", () => {
  it("pins the map orientation to the table's left-to-right layout", () => {
    const p = buildMapPrompt("Chapel Nave. Broken pews, an idol behind the altar.");
    expect(p).toMatch(/entrance[^.]*LEFT edge/i);
    expect(p).toMatch(/RIGHT edge/);
    expect(p).toMatch(/left to right/i);
  });

  it("keeps the scene description after the style and layout", () => {
    const p = buildMapPrompt("Drowned Crypt. Black water between sarcophagi.");
    expect(p.endsWith("Scene: Drowned Crypt. Black water between sarcophagi.")).toBe(true);
    expect(p).toMatch(/^Top-down orthographic/);
  });
});
