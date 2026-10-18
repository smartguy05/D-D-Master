import { describe, expect, it, vi } from "vitest";
import { readMapFeatures } from "./content.js";
import type { LLMProvider } from "./provider.js";

const loc = { name: "Chapel Nave", description: "Broken pews, lantern light behind the altar.", gridW: 22, gridH: 14 };
const png = { mediaType: "image/png" as const, base64: "iVBORw0KGgo=" };

describe("readMapFeatures", () => {
  it("sends the map image and converts image-fraction boxes to grid cells", async () => {
    const reply = JSON.stringify({
      features: [
        { name: "altar", kind: "focal", lit: true, box: [0.54, 0.08, 0.71, 0.37] },
        { name: "west door", kind: "entrance", lit: false, box: [0.0, 0.38, 0.14, 0.6] },
      ],
    });
    const complete = vi.fn().mockResolvedValue(reply);
    const llm: LLMProvider = { name: "fake", model: "m", complete };
    const features = await readMapFeatures(llm, loc, png);
    expect(features).toEqual([
      { name: "altar", kind: "focal", lit: true, x: 11, y: 1, w: 5, h: 5 },
      { name: "west door", kind: "entrance", lit: false, x: 0, y: 5, w: 4, h: 4 },
    ]);
    const call = complete.mock.calls[0][0];
    expect(call.images).toEqual([png]);
    expect(call.prompt).toContain("Chapel Nave");
    expect(call.prompt).toContain("22 x 14");
  });

  it("drops degenerate boxes", async () => {
    const reply = JSON.stringify({ features: [{ name: "speck", kind: "feature", lit: false, box: [0.5, 0.5, 0.5, 0.5] }] });
    const llm: LLMProvider = { name: "fake", model: "m", complete: vi.fn().mockResolvedValue(reply) };
    expect(await readMapFeatures(llm, loc, png)).toEqual([]);
  });
});
