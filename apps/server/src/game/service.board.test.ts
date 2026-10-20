import { describe, expect, it, vi } from "vitest";
import { effectiveFeatures, effectiveWalls, MapFeature } from "@dm/shared";
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

  it("move_token: the host may drop a token on a blocking feature, the DM is redirected and told why", async () => {
    const { g } = game();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await new Promise((r) => setTimeout(r, 10)); // let the background map paint finish (it would drop the edit)
    await g.runTool("edit_map_feature", { action: "add", feature: { name: "pews", blocks: true, x: 5, y: 5 } }, "host");
    const tok = () => g.state!.tokens.find((t) => t.entityType === "character")!;
    const dm = (await g.runTool("move_token", { entity_id: "Thorin", x: 5, y: 5 }, "dm")) as { redirected?: boolean; reason?: string };
    expect(dm).toMatchObject({ redirected: true, reason: "pews blocks that cell" });
    expect([tok().x, tok().y]).not.toEqual([5, 5]);
    const host = (await g.runTool("move_token", { entity_id: "Thorin", x: 5, y: 5 }, "host")) as { redirected?: boolean };
    expect(host.redirected).toBeUndefined();
    expect([tok().x, tok().y]).toEqual([5, 5]);
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

// ---- Phase 1: walls from the map read, wall edits, doors (D2, S3, T1, T2) ----

describe("walls on the board", () => {
  type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
  const seg = (id: string, x1: number, y1: number, x2: number, y2: number, kind: Seg["kind"] = "wall", open = false): Seg => ({ id, x1, y1, x2, y2, kind, open });
  const read = [seg("w1", 5, 0, 5, 3), seg("d1", 5, 3, 5, 4, "door"), seg("w2", 5, 4, 5, 8)];

  function walledGame(url: (fresh: boolean) => string = () => "/m/1.png") {
    const g = new GameService(new Store(":memory:"));
    g.hub.broadcast = () => undefined;
    const map = vi.fn(async (_c: string, _d: string, fresh = false) => url(fresh));
    (g as unknown as { images: unknown }).images = { map, readAsset: () => undefined, available: true };
    (g as unknown as { readFeatures: unknown }).readFeatures = async () => ({ features: [door], walls: read });
    g.createCampaign({ name: "Test" });
    g.addCharacter({ name: "Thorin", maxHp: 12 });
    g.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", mapPrompt: "a nave", gridW: 10, gridH: 8 }] });
    return { g, map };
  }
  const wallsOfLoc = (g: GameService) => (locA(g) as unknown as { walls?: Seg[] }).walls;
  const wallEdit = (g: GameService) => (g.state as unknown as { wallEdits: Record<string, { walls: Seg[] } | undefined> }).wallEdits.loc_a;

  it("paintMap stores the walls read from the map next to the features", async () => {
    const { g } = walledGame();
    await g.generateMap("loc_a");
    expect(locA(g).features.map((f) => f.name)).toEqual(["door"]);
    expect(wallsOfLoc(g)).toEqual(read);
  });

  it("without a brain (or on failure) the map read yields walls []", async () => {
    const g = new GameService(new Store(":memory:"));
    g.hub.broadcast = () => undefined;
    (g as unknown as { images: unknown }).images = { map: async () => "/m/1.png", readAsset: () => ({ mediaType: "image/png", base64: "x" }), available: true };
    (g as unknown as { brain: unknown }).brain = undefined;
    const res = await (g as unknown as { readFeatures: (l: unknown) => Promise<unknown> }).readFeatures({ id: "loc_a", name: "A", description: "", mapUrl: "/m/1.png", gridW: 10, gridH: 8 });
    expect(res).toEqual({ features: [], walls: [] });
    (g as unknown as { brain: unknown }).brain = { name: "fake", model: "m", complete: async () => { throw new Error("down"); } };
    const failed = await (g as unknown as { readFeatures: (l: unknown) => Promise<unknown> }).readFeatures({ id: "loc_a", name: "A", description: "", mapUrl: "/m/1.png", gridW: 10, gridH: 8 });
    expect(failed).toEqual({ features: [], walls: [] });
  });

  it("edit_walls is host-only, and a host edit is undoable", async () => {
    const { g } = walledGame();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.generateMap("loc_a");
    await expect(g.runTool("edit_walls", { action: "reset" }, "dm")).rejects.toThrow(/host/i);
    await g.runTool("edit_walls", { action: "delete", id: "w1" }, "host");
    expect(wallEdit(g)!.walls.map((w) => w.id)).toEqual(["d1", "w2"]);
    expect(g.listHistory(1)[0]!.label).toMatch(/^host: edit_walls/);
    g.undo();
    expect(wallEdit(g)).toBeUndefined();
  });

  it("set_door is open to the DM", async () => {
    const { g } = walledGame();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.generateMap("loc_a");
    const out = (await g.runTool("set_door", { door_id: "d1", open: true }, "dm")) as { open: boolean };
    expect(out.open).toBe(true);
    expect(wallEdit(g)!.walls.find((w) => w.id === "d1")!.open).toBe(true);
  });

  it("a forced repaint keeps the host's wall edits (S3)", async () => {
    const { g } = walledGame(() => "/media/c/map_samehash.png");
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.generateMap("loc_a");
    await g.runTool("edit_walls", { action: "toggle", id: "d1" }, "host");
    await g.generateMap("loc_a", true);
    expect(wallEdit(g)!.walls.find((w) => w.id === "d1")!.open).toBe(true);
    expect(effectiveWalls(g.state!, locA(g) as Parameters<typeof effectiveWalls>[1]).find((w) => w.id === "d1")!.open).toBe(true);
  });

  it("refreshes the DM's instructions (its door list) after set_door and edit_walls (review fix)", async () => {
    const { g } = walledGame();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.generateMap("loc_a");
    const dm = { refreshInstructions: vi.fn() };
    (g as unknown as { dm: unknown }).dm = dm;
    await g.runTool("set_door", { door_id: "d1", open: true }, "dm");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(1);
    await g.runTool("edit_walls", { action: "add", segment: { x1: 1, y1: 1, x2: 1, y2: 2, kind: "door" } }, "host");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(2);
  });

  it("a first paint that reads walls drops fog revealed through them on the blank grid (review fix)", async () => {
    const { g } = walledGame();
    g.updateOutline({ title: "T", locations: [{ id: "loc_a", name: "A", mapPrompt: "a nave", gridW: 10, gridH: 8, fog: true }] });
    const pc = g.state!.characters[0]!;
    (pc as { lightRadius?: number }).lightRadius = 8;
    let land: (url: string) => void = () => undefined;
    (g as unknown as { images: { map: unknown } }).images.map = () => new Promise<string>((r) => (land = r)); // the paint lands later
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    const revealedPast = () => g.state!.fog.loc_a!.revealed.filter((k) => Number(k.split(",")[0]) >= 5);
    expect(revealedPast().length).toBeGreaterThan(0); // blank grid: the light went everywhere
    const painted = g.generateMap("loc_a");
    land("/m/1.png");
    await painted;
    await new Promise((r) => setTimeout(r, 10));
    expect(wallsOfLoc(g)).toEqual(read);
    expect(revealedPast()).toEqual([]);
  });

  it("an old saved state without wallEdits loads with {}", () => {
    const { g } = walledGame();
    const id = g.campaign!.id;
    g.store.db.prepare("UPDATE game_states SET data = ? WHERE campaign_id = ?").run(JSON.stringify({ campaignId: id, version: 3 }), id);
    g.loadCampaign(id);
    expect((g.state as unknown as { wallEdits: unknown }).wallEdits).toEqual({});
  });
});

describe("the DM's 'NPCs here' list stays current (review fix)", () => {
  it("adjust_attitude, set_disposition, add_npc, spawn_monster and remove_monster refresh the instructions", async () => {
    const { g } = game();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await new Promise((r) => setTimeout(r, 10));
    const dm = { refreshInstructions: vi.fn() };
    (g as unknown as { dm: unknown }).dm = dm;
    await g.runTool("add_npc", { name: "Pell Netter" }, "dm");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(1);
    const id = g.state!.monsters.find((x) => x.name === "Pell Netter")!.id;
    await g.runTool("adjust_attitude", { npc_id: id, delta: -2, reason: "an insult" }, "dm");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(2);
    await g.runTool("set_disposition", { monster_id: id, disposition: "foe" }, "host");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(3);
    await g.runTool("spawn_monster", { name: "Goblin" }, "dm");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(4);
    await g.runTool("remove_monster", { monster_id: id }, "dm");
    expect(dm.refreshInstructions).toHaveBeenCalledTimes(5);
  });
});
