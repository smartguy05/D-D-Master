import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../db/index.js";
import { config } from "../config.js";
import { GameService } from "./service.js";

type Cfg = typeof config & { prepaintMaps?: boolean };

/** A service whose image API records map paints (by location name); each paint can be held open. */
function game() {
  const g = new GameService(new Store(":memory:"));
  g.hub.broadcast = () => undefined;
  const pending: Array<() => void> = [];
  let hold = false;
  const map = vi.fn(async (_c: string, desc: string) => {
    if (hold) await new Promise<void>((r) => pending.push(r));
    return `/m/${desc.split(".")[0]}.png`;
  });
  (g as unknown as { images: unknown }).images = { map, sprite: async () => "/s.png", cachedSprite: () => undefined, readAsset: () => undefined, available: true };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  g.createCampaign({ name: "Test" });
  g.updateOutline({
    title: "T",
    locations: [
      { id: "loc_a", name: "Alpha", gridW: 10, gridH: 8 },
      { id: "loc_b", name: "Bravo", gridW: 10, gridH: 8 },
      { id: "loc_c", name: "Charlie", gridW: 10, gridH: 8 },
    ],
  });
  const painted = () => map.mock.calls.map((c) => c[1].split(".")[0]);
  return { g, map, painted, setHold: (h: boolean) => (hold = h), release: () => pending.splice(0).forEach((r) => r()) };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const cfg = config as Cfg;
const original = cfg.prepaintMaps;

describe("GameService map prepaint", () => {
  afterEach(() => {
    cfg.prepaintMaps = original;
  });

  it("config.prepaintMaps defaults to on", () => {
    expect(original).toBe(true);
  });

  it("a scene change paints the new location and the next unpainted one in outline order", async () => {
    const { g, painted } = game();
    cfg.prepaintMaps = true;
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await vi.waitFor(() => expect(painted()).toContain("Bravo"));
    await settle();
    expect(painted()).toContain("Alpha");
    expect(painted()).not.toContain("Charlie");
    await vi.waitFor(() => expect(g.campaign!.outline!.locations.find((l) => l.id === "loc_b")!.mapUrl).toBe("/m/Bravo.png"));
  });

  it("does not prepaint when PREPAINT_MAPS is off", async () => {
    const { g, painted } = game();
    cfg.prepaintMaps = false;
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await vi.waitFor(() => expect(painted()).toContain("Alpha"));
    await settle();
    expect(painted()).toEqual(["Alpha"]);
  });

  it("paints nothing extra when the next location already has a map", async () => {
    const { g, painted } = game();
    cfg.prepaintMaps = true;
    g.campaign!.outline!.locations[1]!.mapUrl = "/m/old-bravo.png";
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await vi.waitFor(() => expect(painted()).toContain("Alpha"));
    await settle();
    expect(painted()).toEqual(["Alpha"]);
  });

  it("arriving at a location whose prepaint is still running shares that paint", async () => {
    const { g, painted, setHold, release } = game();
    cfg.prepaintMaps = true;
    setHold(true);
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await vi.waitFor(() => expect(painted()).toContain("Bravo"));
    await g.runTool("change_scene", { location_id: "loc_b" }, "host");
    await settle();
    setHold(false);
    release();
    await vi.waitFor(() => expect(g.campaign!.outline!.locations.find((l) => l.id === "loc_b")!.mapUrl).toBe("/m/Bravo.png"));
    await settle();
    release();
    expect(painted().filter((n) => n === "Bravo")).toHaveLength(1);
  });

  it("runs only one prepaint at a time", async () => {
    const { g, painted, setHold, release } = game();
    cfg.prepaintMaps = true;
    g.campaign!.outline!.locations[0]!.mapUrl = "/m/old-alpha.png";
    setHold(true);
    await g.runTool("change_scene", { location_id: "loc_a" }, "host"); // prepaints Bravo (held)
    await vi.waitFor(() => expect(painted()).toContain("Bravo"));
    // Leaving and coming back while Bravo is still painting must not start a second prepaint.
    await g.runTool("change_scene", { location_id: "loc_c" }, "host");
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await settle();
    expect(painted().filter((n) => n === "Bravo")).toHaveLength(1);
    setHold(false);
    release();
  });
});

describe("GameService map paints: adversarial review", () => {
  afterEach(() => {
    cfg.prepaintMaps = original;
  });

  /** Every images.map call is held until released by index; the URL says which call it was. */
  function manual() {
    const g = new GameService(new Store(":memory:"));
    g.hub.broadcast = () => undefined;
    const calls: Array<{ desc: string; force: boolean; resolve: () => void }> = [];
    let n = 0;
    const map = vi.fn((_c: string, desc: string, force?: boolean) => {
      const i = n++;
      return new Promise<string>((r) => calls.push({ desc, force: !!force, resolve: () => r(`/m/${desc.split(".")[0]}-${i}${force ? "-forced" : ""}.png`) }));
    });
    (g as unknown as { images: unknown }).images = { map, sprite: async () => "/s.png", cachedSprite: () => undefined, readAsset: () => undefined, available: true };
    (g as unknown as { readFeatures: unknown }).readFeatures = async () => [];
    g.createCampaign({ name: "Test" });
    g.updateOutline({
      title: "T",
      locations: [
        { id: "loc_a", name: "Alpha", gridW: 10, gridH: 8 },
        { id: "loc_b", name: "Bravo", gridW: 10, gridH: 8 },
        { id: "loc_c", name: "Charlie", gridW: 10, gridH: 8 },
      ],
    });
    return { g, calls, map };
  }

  it("a forced repaint started while a normal paint is in flight is not overwritten when the older paint lands last", async () => {
    const { g, calls } = manual();
    cfg.prepaintMaps = false;
    const first = g.generateMap("loc_a"); // e.g. the arrival paint
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const forced = g.generateMap("loc_a", true); // host presses Repaint
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.resolve(); // the repaint lands first …
    await forced;
    calls[0]!.resolve(); // … then the stale paint
    await first;
    expect(g.campaign!.outline!.locations[0]!.mapUrl).toBe("/m/Alpha-1-forced.png");
  });

  it("after arriving at a location whose prepaint was shared, the next location is prepainted once it lands", async () => {
    const { g, calls } = manual();
    cfg.prepaintMaps = true;
    g.campaign!.outline!.locations[0]!.mapUrl = "/m/old-alpha.png";
    await g.runTool("change_scene", { location_id: "loc_a" }, "host"); // prepaints Bravo (held)
    await vi.waitFor(() => expect(calls.map((c) => c.desc.split(".")[0])).toContain("Bravo"));
    await g.runTool("change_scene", { location_id: "loc_b" }, "host"); // arrives while Bravo still paints
    calls.find((c) => c.desc.startsWith("Bravo"))!.resolve();
    await vi.waitFor(() => expect(g.campaign!.outline!.locations[1]!.mapUrl).toBeTruthy());
    await settle();
    // The party is at Bravo; Charlie (next in outline order) should now be painting in the background.
    expect(calls.map((c) => c.desc.split(".")[0])).toContain("Charlie");
    calls.forEach((c) => c.resolve());
  });
});

describe("GameService map prepaint: failures", () => {
  it("a failed prepaint is not retried in the background", async () => {
    const { g, map, painted } = game();
    map.mockImplementation(async (_c: string, desc: string) => {
      if (desc.startsWith("Bravo")) throw new Error("content policy");
      return `/m/${desc.split(".")[0]}.png`;
    });
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await settle();
    await settle();
    expect(painted().filter((n) => n === "Bravo")).toHaveLength(1);
  });

  it("arriving at the middle location prepaints the one after it", async () => {
    const { g, painted } = game();
    await g.runTool("change_scene", { location_id: "loc_b" }, "host");
    await settle();
    expect(painted()).toEqual(expect.arrayContaining(["Bravo", "Charlie"]));
  });
});
