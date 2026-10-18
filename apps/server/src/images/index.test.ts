import { describe, expect, it } from "vitest";
import { buildMapPrompt, imageFileName } from "./index.js";

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

describe("imageFileName", () => {
  it("is stable for the same prompt (cache) and new for a fresh repaint", () => {
    const a = imageFileName("map", "m", "1536x1024", "a nave");
    expect(imageFileName("map", "m", "1536x1024", "a nave")).toBe(a);
    expect(a).toMatch(/^map_[0-9a-f]{12}\.png$/);
    const fresh = imageFileName("map", "m", "1536x1024", "a nave", "n1");
    expect(fresh).not.toBe(a);
    expect(imageFileName("map", "m", "1536x1024", "a nave", "n2")).not.toBe(fresh);
  });
});
