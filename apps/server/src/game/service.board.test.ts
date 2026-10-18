import { describe, expect, it } from "vitest";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

function game() {
  const g = new GameService(new Store(":memory:"));
  g.hub.broadcast = () => undefined;
  g.createCampaign({ name: "Test" });
  return g;
}

describe("GameService host board tools", () => {
  it("refuses host-only tools from the DM", async () => {
    const g = game();
    await expect(g.runTool("edit_fog", { mode: "hide", cells: [[1, 1]] }, "dm")).rejects.toThrow(/host/i);
    await expect(g.runTool("edit_map_feature", { action: "reset" }, "dm")).rejects.toThrow(/host/i);
  });

  it("host board edits are undoable with a host: label", async () => {
    const g = game();
    g.addCharacter({ name: "Thorin", maxHp: 12 });
    g.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", gridW: 10, gridH: 8 }] });
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("edit_map_feature", { action: "add", feature: { name: "pews", blocks: true, x: 2, y: 2 } }, "host");
    expect(g.state!.featureEdits.loc_a!.features).toHaveLength(1);
    expect(g.listHistory(1)[0]!.label).toMatch(/^host: edit_map_feature/);
    g.undo();
    expect(g.state!.featureEdits.loc_a).toBeUndefined();
  });
});
