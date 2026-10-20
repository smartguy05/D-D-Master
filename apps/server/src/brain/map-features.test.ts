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
        { name: "pews", kind: "feature", lit: false, blocks: true, box: [0.2, 0.2, 0.4, 0.3] },
      ],
    });
    const complete = vi.fn().mockResolvedValue(reply);
    const llm: LLMProvider = { name: "fake", model: "m", complete };
    const { features, walls } = await readMapFeatures(llm, loc, png);
    expect(walls).toEqual([]); // a reply without walls
    expect(features).toEqual([
      { name: "altar", kind: "focal", lit: true, blocks: false, interactive: false, x: 11, y: 1, w: 5, h: 5 },
      { name: "west door", kind: "entrance", lit: false, blocks: false, interactive: false, x: 0, y: 5, w: 4, h: 4 },
      { name: "pews", kind: "feature", lit: false, blocks: true, interactive: false, x: 4, y: 2, w: 5, h: 3 },
    ]);
    const call = complete.mock.calls[0][0];
    expect(call.images).toEqual([png]);
    expect(call.prompt).toContain("Chapel Nave");
    expect(call.prompt).toContain("22 x 14");
    expect(call.prompt).toMatch(/blocks: true/);
  });

  it("drops degenerate boxes", async () => {
    const reply = JSON.stringify({ features: [{ name: "speck", kind: "feature", lit: false, box: [0.5, 0.5, 0.5, 0.5] }] });
    const llm: LLMProvider = { name: "fake", model: "m", complete: vi.fn().mockResolvedValue(reply) };
    expect(await readMapFeatures(llm, loc, png)).toEqual({ features: [], walls: [] });
  });

  it("asks for wall, door and window polylines and snaps them to grid edges", async () => {
    const reply = JSON.stringify({
      features: [],
      walls: [
        { kind: "wall", points: [[0.5, 0], [0.5, 0.5]] },
        { kind: "door", points: [[0.5, 0.5], [0.5, 0.57]] },
      ],
    });
    const complete = vi.fn().mockResolvedValue(reply);
    const llm: LLMProvider = { name: "fake", model: "m", complete };
    const { features, walls } = await readMapFeatures(llm, loc, png);
    expect(features).toEqual([]);
    const norm = (w: { x1: number; y1: number; x2: number; y2: number }) => [Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2)];
    const wall = walls.filter((w) => w.kind === "wall");
    expect(wall.reduce((n, w) => n + Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1), 0)).toBe(7);
    expect(wall.every((w) => w.x1 === 11 && w.x2 === 11)).toBe(true);
    const doors = walls.filter((w) => w.kind === "door");
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ id: "d1", open: false });
    expect(norm(doors[0]!)).toEqual([11, 7, 11, 8]);
    const prompt = complete.mock.calls[0][0].prompt as string;
    expect(prompt).toMatch(/polyline/i);
    expect(prompt).toMatch(/window/i);
  });
});

describe("readMapFeatures interactive features (F2)", () => {
  it("asks the vision model to mark usable things and returns interactive: true, missing as false", async () => {
    const reply = JSON.stringify({
      features: [
        { name: "sluice lever", kind: "feature", lit: false, blocks: true, interactive: true, box: [0.7, 0.5, 0.75, 0.55] },
        { name: "pews", kind: "feature", lit: false, blocks: true, box: [0.2, 0.2, 0.4, 0.3] },
      ],
    });
    const complete = vi.fn().mockResolvedValue(reply);
    const llm: LLMProvider = { name: "fake", model: "m", complete };
    const { features } = await readMapFeatures(llm, loc, png);
    expect(features).toHaveLength(2);
    expect((features[0] as { interactive?: boolean }).interactive).toBe(true);
    expect((features[1] as { interactive?: boolean }).interactive).toBe(false);
    const prompt = complete.mock.calls[0][0].prompt as string;
    expect(prompt).toMatch(/interactive: true/);
    for (const w of ["lever", "chest", "altar"]) expect(prompt.toLowerCase()).toContain(w);
  });
});
