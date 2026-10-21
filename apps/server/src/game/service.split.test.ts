import { describe, expect, it, vi } from "vitest";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

/** A service with three locations, a fake live DM, map paints recorded, and a party of three. */
function setup() {
  const game = new GameService(new Store(":memory:"));
  vi.spyOn(game.hub, "broadcast").mockImplementation(() => undefined);
  const map = vi.fn(async (_c: string, desc: string) => `/m/${desc.split(".")[0]}.png`);
  (game as any).images = { map, sprite: async () => "/s.png", cachedSprite: () => undefined, readAsset: () => undefined, available: true };
  let features: unknown = { features: [], walls: [] };
  (game as any).readFeatures = async () => features;
  game.createCampaign({ name: "Test" });
  game.updateOutline({
    title: "T",
    locations: [
      { id: "loc_a", name: "Alpha", gridW: 10, gridH: 8 },
      { id: "loc_b", name: "Bravo", gridW: 10, gridH: 8 },
      { id: "loc_c", name: "Charlie", gridW: 10, gridH: 8 },
    ],
  });
  const dm = { isOpen: true, prompt: vi.fn(), addSystemNote: vi.fn(), refreshInstructions: vi.fn(), holdResponses: vi.fn(), close: vi.fn() };
  (game as any).dm = dm;
  const sam = game.addPlayer("Sam");
  const alex = game.addPlayer("Alex");
  const kim = game.addPlayer("Kim");
  const thorin = game.addCharacter({ name: "Thorin", maxHp: 12 }, sam.id);
  const lyra = game.addCharacter({ name: "Lyra", maxHp: 8 }, alex.id);
  const bram = game.addCharacter({ name: "Bram", maxHp: 10 }, kim.id);
  return { game, dm, map, thorin, lyra, bram, setFeatures: (f: unknown) => (features = f) };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("party split in the service", () => {
  it("a partial change_scene paints the destination map and refreshes the DM's instructions", async () => {
    const { game, dm, thorin } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await settle();
    dm.refreshInstructions.mockClear();
    const gen = vi.spyOn(game, "generateMap");
    await game.runTool("change_scene", { location_id: "loc_b", character_ids: [thorin.id] });
    await settle();
    expect(gen).toHaveBeenCalledWith("loc_b");
    expect(game.campaign!.outline!.locations.find((l) => l.id === "loc_b")!.mapUrl).toBe("/m/Bravo.png");
    expect(dm.refreshInstructions).toHaveBeenCalled();
    expect(Object.keys(game.state!.scenes)).toEqual(["loc_a"]);
  });

  it("a host focus_scene tells the DM where the spotlight went, without listing monsters", async () => {
    const { game, dm, thorin } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b", character_ids: [thorin.id] });
    await game.runTool("focus_scene", { location_id: "loc_a" }, "host");
    const note = dm.addSystemNote.mock.calls.map((c) => String(c[0])).find((t) => t.includes("spotlight"));
    expect(note).toBe("Host moved the spotlight to Alpha: Lyra, Bram are now in focus. Pick up with them; don't call focus_scene again.");
  });

  it("painting a parked group's map restages that group, not the focused one", async () => {
    const { game, thorin, setFeatures } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await settle();
    await game.runTool("change_scene", { location_id: "loc_b", character_ids: [thorin.id] });
    await settle();
    // The Alpha group's tokens moved off the entrance; a forced repaint of Alpha (now parked) puts them back.
    for (const t of game.state!.scenes.loc_a!.tokens) t.x = 9;
    setFeatures({ features: [{ name: "door", kind: "entrance", x: 0, y: 3, w: 1, h: 2 }], walls: [] });
    await game.generateMap("loc_a", true);
    const parked = game.state!.scenes.loc_a!.tokens;
    expect(parked.every((t) => t.x <= 2)).toBe(true);
    expect(game.state!.locationId).toBe("loc_b");
    expect(game.state!.tokens.map((t) => t.entityId)).toEqual([thorin.id]);
  });

  it("removing an away character forgets their location and their group's scene", async () => {
    const { game, thorin } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b", character_ids: [thorin.id] });
    game.removeCharacter(game.state!.characters.find((c) => c.name === "Lyra")!.id);
    game.removeCharacter(game.state!.characters.find((c) => c.name === "Bram")!.id);
    expect(game.state!.partyLocations).toEqual({});
    expect(game.state!.scenes).toEqual({});
  });

  it("undo restores the parked scenes", async () => {
    const { game, thorin } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b", character_ids: [thorin.id] });
    const split = structuredClone({ scenes: game.state!.scenes, partyLocations: game.state!.partyLocations });
    await game.runTool("focus_scene", { location_id: "loc_a" });
    game.undo();
    expect(game.state!.locationId).toBe("loc_b");
    expect({ scenes: game.state!.scenes, partyLocations: game.state!.partyLocations }).toEqual(split);
  });
});
