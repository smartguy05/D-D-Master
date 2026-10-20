import { describe, expect, it } from "vitest";
import { lightRadiusOf } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

describe("characters from drafts carry the default light (bug: pregens-blind-in-fog)", () => {
  it("a draft's lightRadius 0 (a pregen made before the fix) is dropped", () => {
    const game = new GameService(new Store(":memory:"));
    game.createCampaign({ name: "Market" });
    const c = game.addCharacter({ name: "Bram", maxHp: 12, lightRadius: 0 } as Parameters<GameService["addCharacter"]>[0]);
    expect(c.lightRadius).toBeUndefined();
    expect(lightRadiusOf(c)).toBeGreaterThan(0);
  });

  it("the host can still set a light radius on purpose", () => {
    const game = new GameService(new Store(":memory:"));
    game.createCampaign({ name: "Market" });
    const c = game.addCharacter({ name: "Bram", maxHp: 12 });
    game.updateCharacter(c.id, { lightRadius: 2 });
    expect(game.state!.characters.find((x) => x.id === c.id)!.lightRadius).toBe(2);
  });
});

describe("a host light change reveals at once (bug: pregens-blind-in-fog)", () => {
  it("raising a blind PC's light clears the fog around its token without a move", async () => {
    const game = new GameService(new Store(":memory:"));
    game.hub.broadcast = () => undefined;
    game.createCampaign({ name: "Market" });
    const c = game.addCharacter({ name: "Bram", maxHp: 12 });
    game.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", mapPrompt: "a cistern", gridW: 20, gridH: 12, fog: true }] });
    game.updateCharacter(c.id, { lightRadius: 0 });
    await game.runTool("change_scene", { location_id: "loc_a" }, "host");
    const before = game.state!.fog.loc_a!.revealed.length;
    game.updateCharacter(c.id, { lightRadius: 6 });
    expect(game.state!.fog.loc_a!.revealed.length).toBeGreaterThan(before);
  });
});
