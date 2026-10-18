import { describe, expect, it, vi } from "vitest";
import { effectiveFeatures, MapFeature } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

const door = MapFeature.parse({ name: "door", kind: "entrance", x: 0, y: 6, w: 1, h: 2 });
const altar = MapFeature.parse({ name: "altar", kind: "focal", x: 7, y: 1, w: 2, h: 2 });

/** A service with the image API (cached by prompt hash) and the vision read stubbed out. */
function game(opts: { url?: (fresh: boolean) => string; features?: () => MapFeature[] } = {}) {
  const g = new GameService(new Store(":memory:"));
  g.hub.broadcast = () => undefined;
  const map = vi.fn(async (_c: string, _d: string, fresh = false) => (opts.url ?? (() => "/m/1.png"))(fresh));
  (g as unknown as { images: unknown }).images = { map, readAsset: () => undefined, available: true };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => (opts.features ?? (() => []))();
  g.createCampaign({ name: "Test" });
  g.addCharacter({ name: "Thorin", maxHp: 12 });
  g.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", mapPrompt: "a nave", gridW: 10, gridH: 8 }] });
  return { g, map };
}

const locA = (g: GameService) => g.campaign!.outline!.locations.find((l) => l.id === "loc_a")!;

describe("GameService host board tools", () => {
  it("refuses host-only tools from the DM and logs no tool event for them", async () => {
    const { g } = game();
    const before = g.store.eventsSince(g.campaign!.id, 0).length;
    await expect(g.runTool("edit_fog", { mode: "hide", cells: [[1, 1]] }, "dm")).rejects.toThrow(/host/i);
    await expect(g.runTool("edit_map_feature", { action: "reset" }, "dm")).rejects.toThrow(/host/i);
    expect(g.store.eventsSince(g.campaign!.id, 0).length).toBe(before);
  });

  it("host board edits are undoable with a host: label", async () => {
    const { g } = game();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("edit_map_feature", { action: "add", feature: { name: "pews", blocks: true, x: 2, y: 2 } }, "host");
    expect(g.state!.featureEdits.loc_a!.features).toHaveLength(1);
    expect(g.listHistory(1)[0]!.label).toMatch(/^host: edit_map_feature/);
    g.undo();
    expect(g.state!.featureEdits.loc_a).toBeUndefined();
  });

  it("refreshes the DM's instructions after a feature edit (the map feature list changed)", async () => {
    const { g } = game();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await new Promise((r) => setTimeout(r, 10)); // let the scene change's background map paint finish
    const dm = { refreshInstructions: vi.fn() };
    (g as unknown as { dm: unknown }).dm = dm;
    await g.runTool("edit_fog", { mode: "hide", cells: [[1, 1]] }, "host");
    expect(dm.refreshInstructions).not.toHaveBeenCalled();
    await g.runTool("edit_map_feature", { action: "add", feature: { name: "pews", x: 2, y: 2 } }, "host");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(1);
  });
});

describe("repaint resets host board edits", () => {
  it("a forced repaint asks the image service for a fresh picture", async () => {
    const { g, map } = game();
    await g.generateMap("loc_a");
    await g.generateMap("loc_a", true);
    expect(map.mock.calls.map((c) => c[2])).toEqual([false, true]);
  });

  // The real ImageService gives a forced repaint a new URL (images/index.test.ts). This stub keeps
  // the URL on purpose: generateMap must reset on `force` itself, not rely on the URL changing.
  it("'Repaint map' drops the host's feature edits even when the URL is unchanged, and it is undoable", async () => {
    const { g } = game({ url: () => "/media/c/map_samehash.png", features: () => [door, altar] });
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.generateMap("loc_a");
    await g.runTool("edit_map_feature", { action: "delete", index: 1 }, "host");
    expect(effectiveFeatures(g.state!, locA(g)).map((f) => f.name)).toEqual(["door"]);
    await g.generateMap("loc_a", true);
    expect(effectiveFeatures(g.state!, locA(g)).map((f) => f.name)).toEqual(["door", "altar"]);
    expect(g.listHistory(1)[0]!.label).toBe("map repainted: A");
    g.undo();
    expect(g.state!.featureEdits.loc_a).toBeDefined();
  });

  it("a repaint whose map read finds no features still clears the host's hidden fog cells", async () => {
    let n = 0;
    const { g } = game({ url: () => `/media/c/map_${++n}.png`, features: () => (n === 1 ? [door, altar] : []) });
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.generateMap("loc_a");
    await g.runTool("set_fog", { mode: "enable" }, "host");
    await g.runTool("edit_fog", { mode: "hide", cells: [[5, 5]] }, "host");
    await g.generateMap("loc_a", true);
    expect(g.state!.fog.loc_a!.hidden).toEqual([]);
  });
});

describe("old saves", () => {
  it("a saved state and a history row without featureEdits / fog.hidden / blocks load and undo", async () => {
    const { g } = game();
    const id = g.campaign!.id;
    const old = { campaignId: id, locationId: "loc_a", fog: { loc_a: { enabled: true, revealed: ["1,1"] } }, version: 7 };
    g.store.db.prepare("UPDATE game_states SET data = ? WHERE campaign_id = ?").run(JSON.stringify(old), id);
    g.store.db
      .prepare("INSERT INTO state_history (campaign_id, version, ts, label, data) VALUES (?, ?, ?, ?, ?)")
      .run(id, 6, Date.now(), "old", JSON.stringify({ ...old, version: 6 }));
    g.loadCampaign(id);
    expect(g.state!.featureEdits).toEqual({});
    expect(g.state!.fog.loc_a!.hidden).toEqual([]);
    await g.runTool("edit_fog", { mode: "hide", cells: [[1, 1]] }, "host");
    g.undo();
    expect(g.state!.fog.loc_a!.hidden).toEqual([]);
    g.restoreHistory(6);
    expect(g.state!.featureEdits).toEqual({});
    expect(g.state!.fog.loc_a!.hidden).toEqual([]);
  });
});

/** A service whose image API resolves only when the test says so. */
function slowGame() {
  const g = new GameService(new Store(":memory:"));
  g.hub.broadcast = () => undefined;
  const pending: ((url: string) => void)[] = [];
  const map = vi.fn((_c: string, _d: string, _fresh = false) => new Promise<string>((res) => pending.push(res)));
  (g as unknown as { images: unknown }).images = { map, readAsset: () => undefined, available: true };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => [door];
  g.createCampaign({ name: "Test" });
  g.addCharacter({ name: "Thorin", maxHp: 12 });
  g.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", mapPrompt: "a nave", gridW: 10, gridH: 8 }] });
  return { g, pending };
}
const flush = () => new Promise((r) => setTimeout(r, 5));

describe("generateMap side effects", () => {
  it("the FIRST paint of a location (not a repaint) keeps the fog revealed and hidden while it was painting", async () => {
    const { g, pending } = slowGame();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host"); // starts the background first paint
    await g.runTool("set_fog", { mode: "enable" }, "host");
    await g.runTool("reveal_area", { x: 8, y: 1, radius: 0 }, "dm");
    await g.runTool("edit_fog", { mode: "hide", cells: [[7, 7]] }, "host");
    expect(pending).toHaveLength(1);
    pending[0]!("/media/c/map_first.png");
    await flush();
    expect(g.state!.fog.loc_a!.revealed).toContain("8,1");
    expect(g.state!.fog.loc_a!.hidden).toContain("7,7");
    expect(g.listHistory(1)[0]!.label).toBe("map painted: A"); // party restaged to the entrance
  });

  it("a repaint that finishes after the host loaded ANOTHER campaign does not touch that campaign, and saves the first", async () => {
    const { g, pending } = slowGame();
    const first = g.campaign!.id;
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    pending[0]!("/media/c/map_1.png");
    await flush();
    const repaint = g.generateMap("loc_a", true);
    g.createCampaign({ name: "Other" });
    const other = g.campaign!.id;
    g.addCharacter({ name: "Bria", maxHp: 9 });
    g.updateOutline({ title: "T2", locations: [{ id: "loc_a", name: "A", gridW: 10, gridH: 8 }] });
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("edit_map_feature", { action: "add", feature: { name: "pews", x: 2, y: 2 } }, "host");
    const before = JSON.stringify(g.state!.featureEdits);
    const otherMap = g.campaign!.outline!.locations[0]!.mapUrl;
    pending[pending.length - 2]!("/media/c/map_2.png"); // the first campaign's repaint lands now
    await repaint;
    expect(g.campaign!.id).toBe(other);
    expect(JSON.stringify(g.state!.featureEdits)).toBe(before);
    expect(g.campaign!.outline!.locations[0]!.mapUrl).toBe(otherMap);
    expect(g.listHistory(5).map((h) => h.label)).not.toContain("map repainted: A");
    expect(first).not.toBe(other);
    // the first campaign got its new map in the database
    expect(g.store.getCampaign(first)!.outline!.locations[0]!.mapUrl).toBe("/media/c/map_2.png");
  });
});

describe("generateMap across campaign switches", () => {
  it("switching away and BACK before the repaint lands: the live campaign gets the map and the repaint resets", async () => {
    const { g, pending } = slowGame();
    const first = g.campaign!.id;
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    pending[0]!("/media/c/map_1.png");
    await flush();
    await g.runTool("edit_map_feature", { action: "add", feature: { name: "pews", x: 2, y: 2 } }, "host");
    const repaint = g.generateMap("loc_a", true);
    g.createCampaign({ name: "Other" });
    g.loadCampaign(first);
    pending[pending.length - 1]!("/media/c/map_2.png");
    await repaint;
    expect(g.campaign!.outline!.locations[0]!.mapUrl).toBe("/media/c/map_2.png");
    expect(g.store.getCampaign(first)!.outline!.locations[0]!.mapUrl).toBe("/media/c/map_2.png");
    expect(g.state!.featureEdits.loc_a).toBeUndefined();
  });

  it("a forced repaint that lands while the campaign is NOT loaded still drops the old picture's host feature edits / fog", async () => {
    const { g, pending } = slowGame();
    const first = g.campaign!.id;
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    pending[0]!("/media/c/map_1.png");
    await flush();
    await g.runTool("set_fog", { mode: "enable" }, "host");
    await g.runTool("edit_fog", { mode: "hide", cells: [[7, 7]] }, "host");
    await g.runTool("edit_map_feature", { action: "add", feature: { name: "pews", x: 2, y: 2 } }, "host");
    const repaint = g.generateMap("loc_a", true);
    g.createCampaign({ name: "Other" });
    pending[pending.length - 1]!("/media/c/map_2.png");
    await repaint;
    g.loadCampaign(first);
    expect(g.campaign!.outline!.locations[0]!.mapUrl).toBe("/media/c/map_2.png"); // new picture...
    expect(g.state!.featureEdits.loc_a).toBeUndefined(); // ...so the old picture's fixes must be gone
    expect(g.state!.fog.loc_a!.hidden).toEqual([]);
  });

  it("campaign deleted mid-paint: generateMap resolves and nothing is resurrected", async () => {
    const { g, pending } = slowGame();
    const first = g.campaign!.id;
    const p = g.generateMap("loc_a");
    g.deleteCampaign(first);
    pending[0]!("/media/c/map_1.png");
    await expect(p).resolves.toBe("/media/c/map_1.png");
    expect(g.store.getCampaign(first)).toBeUndefined();
    expect(g.campaign).toBeNull();
  });
});
