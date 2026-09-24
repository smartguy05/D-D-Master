import { describe, expect, it } from "vitest";
import { Outline } from "@dm/shared";
import { Store } from "../db/index.js";
import { mergeOutline } from "./outline.js";
import { GameService } from "./service.js";

const prev = Outline.parse({
  title: "Old",
  locations: [
    { id: "loc_a", name: "A", mapPrompt: "a cave", mapUrl: "/media/c/map_a.png" },
    { id: "loc_b", name: "B", mapPrompt: "a keep", mapUrl: "/media/c/map_b.png" },
  ],
  encounters: [{ id: "enc_1", locationId: "loc_a", monsters: [{ name: "Goblin Warrior", count: 2 }] }],
});

describe("mergeOutline", () => {
  it("keeps mapUrl when mapPrompt is unchanged and clears it when it changed", () => {
    const next = mergeOutline(prev, {
      ...prev,
      title: "New",
      locations: [
        { ...prev.locations[0], name: "Renamed A", mapUrl: undefined },
        { ...prev.locations[1], mapPrompt: "a ruined keep" },
      ],
    });
    expect(next.title).toBe("New");
    expect(next.locations[0]).toMatchObject({ name: "Renamed A", mapUrl: "/media/c/map_a.png" });
    expect(next.locations[1].mapUrl).toBeUndefined();
  });

  it("ignores client-sent mapUrls and gives new locations/encounters ids", () => {
    const next = mergeOutline(prev, {
      title: "T",
      locations: [{ name: "Fresh", mapPrompt: "x", mapUrl: "/media/evil/x.png" }],
      encounters: [],
    });
    expect(next.locations[0].id).toMatch(/^loc_/);
    expect(next.locations[0].mapUrl).toBeUndefined();
    expect(next.locations[0]).toMatchObject({ gridW: 24, gridH: 16 });
  });

  it("rejects invalid outlines", () => {
    expect(() => mergeOutline(prev, { title: 5 })).toThrow(/Invalid outline: title/);
    expect(() => mergeOutline(prev, { ...prev, locations: [{ ...prev.locations[0], gridW: 999 }] })).toThrow(/gridW/);
    expect(() => mergeOutline(prev, { ...prev, locations: [prev.locations[0], prev.locations[0]] })).toThrow(/duplicate location/);
    expect(() => mergeOutline(prev, { ...prev, locations: [prev.locations[1]] })).toThrow(/unknown location loc_a/);
    expect(() => mergeOutline(prev, { ...prev, encounters: [{ id: "e", locationId: "loc_a", monsters: [{ name: "Orc", count: 0 }] }] })).toThrow(/count/);
  });

  it("GameService.updateOutline saves the campaign", () => {
    const game = new GameService(new Store(":memory:"));
    const c = game.createCampaign({ name: "Edit me" });
    const out = game.updateOutline({ title: "Edited", acts: [{ title: "One", summary: "Start" }], locations: [{ name: "Inn" }] });
    expect(out.acts).toHaveLength(1);
    expect(game.store.getCampaign(c.id)!.outline!.title).toBe("Edited");
  });
});
