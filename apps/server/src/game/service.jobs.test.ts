import { describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import type { LLMProvider } from "../brain/provider.js";
import { GameService } from "./service.js";

type JobEvent = Extract<ServerEvent, { type: "job" }> & { startedAt?: number };

function game() {
  const g = new GameService(new Store(":memory:"));
  const events: ServerEvent[] = [];
  g.hub.broadcast = (ev: ServerEvent) => void events.push(ev);
  (g as unknown as { images: unknown }).images = { map: async () => "/m.png", sprite: async () => "/s.png", cachedSprite: () => undefined, readAsset: () => undefined, available: true };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  g.createCampaign({ name: "Test" });
  const jobs = () => events.filter((e): e is JobEvent => e.type === "job");
  return { g, jobs };
}

describe("GameService job events", () => {
  it("carry the job's start time on running and done", async () => {
    const { g, jobs } = game();
    g.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", gridW: 10, gridH: 8 }] });
    const before = Date.now();
    await g.generateMap("loc_a");
    const paint = jobs().filter((j) => j.label.startsWith("Painting map"));
    expect(paint.map((j) => j.status)).toEqual(["running", "done"]);
    expect(typeof paint[0]!.startedAt).toBe("number");
    expect(paint[0]!.startedAt).toBeGreaterThanOrEqual(before);
    expect(paint[1]!.startedAt).toBe(paint[0]!.startedAt);
  });

  it("carry the start time on error too", async () => {
    const { g, jobs } = game();
    (g as unknown as { images: { map: unknown } }).images.map = async () => {
      throw new Error("boom");
    };
    g.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", gridW: 10, gridH: 8 }] });
    await expect(g.generateMap("loc_a")).rejects.toThrow("boom");
    const paint = jobs().filter((j) => j.label.startsWith("Painting map"));
    expect(paint.map((j) => j.status)).toEqual(["running", "error"]);
    expect(typeof paint[1]!.startedAt).toBe("number");
    expect(paint[1]!.startedAt).toBe(paint[0]!.startedAt);
  });
});

describe("GameService.generatePregens", () => {
  it("normalises prose spell lists against the SRD spell catalog", async () => {
    const { g } = game();
    await g.init(); // loads the SRD spell catalog
    const reply = {
      characters: [
        {
          name: "Sister Morra Tideward",
          className: "Cleric",
          maxHp: 10,
          spells: ["Spellcasting: Wisdom; spell save DC 13; +5 to hit", "Prepared level-1 cleric spells: Bless, Cure Wounds, Guiding Bolt", "Cantrips: Sacred Flame, Guidance and Light"],
        },
      ],
    };
    const brain: LLMProvider = { name: "fake", model: "m", complete: vi.fn().mockResolvedValue(JSON.stringify(reply)) };
    (g as unknown as { brain: LLMProvider }).brain = brain;
    const [c] = await g.generatePregens(1, "a healer cleric");
    expect(c!.spells).toEqual(["Bless", "Cure Wounds", "Guiding Bolt", "Sacred Flame", "Guidance", "Light"]);
  });
});
