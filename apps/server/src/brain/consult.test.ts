import { describe, expect, it } from "vitest";
import { Campaign, GameState, MapFeature, Monster } from "@dm/shared";
import { consult } from "./content.js";
import type { LLMProvider } from "./provider.js";

function capture() {
  const seen = { prompt: "" };
  const llm: LLMProvider = { name: "fake", model: "fake", complete: async (o) => ((seen.prompt = o.prompt ?? ""), "ok") };
  return { llm, seen };
}

describe("consult (brain planner prompt)", () => {
  it("carries the host's feature edit for the current map, not the stale vision read", async () => {
    const { llm, seen } = capture();
    const stale = MapFeature.parse({ name: "stale-altar", kind: "focal", x: 11, y: 1 });
    const fixed = MapFeature.parse({ name: "fixed-altar", kind: "focal", x: 3, y: 3 });
    const campaign = Campaign.parse({
      id: "c",
      name: "C",
      createdAt: 0,
      updatedAt: 0,
      outline: { title: "T", locations: [{ id: "loc_a", name: "A", mapUrl: "/m/1.png", features: [stale] }] },
    });
    const state = GameState.parse({ campaignId: "c", locationId: "loc_a", featureEdits: { loc_a: { mapUrl: "/m/1.png", features: [fixed] } } });
    await consult(llm, campaign, state, "where is the altar?");
    expect(seen.prompt).toContain("fixed-altar");
    expect(seen.prompt).not.toContain("stale-altar");
    expect(campaign.outline!.locations[0]!.features[0]!.name).toBe("stale-altar"); // campaign untouched
  });

  it("flags monsters hidden from the table", async () => {
    const { llm, seen } = capture();
    const campaign = Campaign.parse({ id: "c", name: "C", createdAt: 0, updatedAt: 0 });
    const state = GameState.parse({
      campaignId: "c",
      monsters: [Monster.parse({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, hidden: true }), Monster.parse({ id: "m2", name: "Rat", maxHp: 2, hp: 2 })],
    });
    await consult(llm, campaign, state, "?");
    expect(seen.prompt).toContain("Goblin 7/7 (hidden from the table)");
    expect(seen.prompt).toMatch(/Rat 2\/2(?! \(hidden)/);
  });
});
