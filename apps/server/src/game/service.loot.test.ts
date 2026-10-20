import { describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

/** Loot icons, pick-up toasts and DM instruction refreshes in the service (Phase 3: M2, P3, G2). */

type Obj = { id: string; kind: string; name: string; iconUrl?: string; items: Array<{ name: string; iconUrl?: string }> };
const objects = (g: GameService) => ((g.state as unknown as { mapObjects?: Obj[] }).mapObjects ?? []) as Obj[];

/** A service whose image API is stubbed (like service.sprites.test.ts); item draws can be held open. */
function game(opts: { available?: boolean } = {}) {
  const g = new GameService(new Store(":memory:"));
  const events: ServerEvent[] = [];
  g.hub.broadcast = (ev) => void events.push(ev);
  const drawn = new Map<string, string>();
  const pending: Array<() => void> = [];
  let hold = false;
  const sprite = vi.fn(async (campaignId: string) => `/media/${campaignId}/sprite.png`);
  const itemIcon = vi.fn(async (campaignId: string, name: string) => {
    if (hold) await new Promise<void>((r) => pending.push(r));
    const url = `/media/${campaignId}/item_${name.toLowerCase().replace(/\W+/g, "_")}.png`;
    drawn.set(`${campaignId}|${name.toLowerCase()}`, url);
    return url;
  });
  const cachedItemIcon = vi.fn((campaignId: string, name: string) => drawn.get(`${campaignId}|${name.toLowerCase()}`));
  const lootSack = vi.fn(async (campaignId: string) => `/media/${campaignId}/item_sack.png`);
  (g as unknown as { images: unknown }).images = {
    sprite,
    cachedSprite: () => undefined,
    itemIcon,
    cachedItemIcon,
    lootSack,
    map: async () => "/m.png",
    readAsset: () => undefined,
    available: opts.available ?? true,
  };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  const dm = { isOpen: true, prompt: vi.fn(), addSystemNote: vi.fn(), refreshInstructions: vi.fn(), holdResponses: vi.fn(), close: vi.fn() };
  const release = () => pending.splice(0).forEach((r) => r());
  return { g, events, dm, itemIcon, cachedItemIcon, lootSack, drawn, setHold: (h: boolean) => (hold = h), release, attachDm: () => ((g as unknown as { dm: unknown }).dm = dm) };
}

const outline = { title: "T", locations: [{ id: "loc_a", name: "A", gridW: 10, gridH: 8 }] };

async function scene(t: ReturnType<typeof game>) {
  const c = t.g.createCampaign({ name: "Test" });
  t.g.updateOutline(outline);
  const pc = t.g.addCharacter({ name: "Sylvaine", maxHp: 8 });
  await t.g.runTool("change_scene", { location_id: "loc_a" }, "host");
  return { c, pc };
}

describe("drawItemIcon (M2)", () => {
  it("shares one draw between concurrent calls for the same campaign and name (any case)", async () => {
    const t = game();
    const { c } = await scene(t);
    t.setHold(true);
    const draw = (t.g as unknown as { drawItemIcon(campaignId: string, name: string): Promise<string> }).drawItemIcon.bind(t.g);
    const a = draw(c.id, "Dagger");
    const b = draw(c.id, "dagger");
    await vi.waitFor(() => expect(t.itemIcon).toHaveBeenCalledTimes(1));
    t.setHold(false);
    t.release();
    expect(await a).toBe(await b);
    expect(t.itemIcon).toHaveBeenCalledTimes(1);
  });
});

describe("loot icons after drop_loot (M2)", () => {
  it("fills each item's icon, the loot sack, and matching inventory items, then broadcasts the state", async () => {
    const t = game();
    const { pc } = await scene(t);
    await t.g.runTool("give_item", { character_id: pc.id, name: "Dagger" }, "host");
    t.drawn.set(`${t.g.campaign!.id}|gem`, `/media/${t.g.campaign!.id}/item_gem_cached.png`); // already drawn
    const out = (await t.g.runTool("drop_loot", { x: 2, y: 3, items: [{ name: "Dagger", qty: 2 }, { name: "Gem" }], gold: 4 })) as { object_id: string };
    expect(out.object_id).toBeTruthy();
    await vi.waitFor(() => {
      const o = objects(t.g).find((x) => x.id === out.object_id)!;
      expect(o.iconUrl).toMatch(/item_sack\.png$/);
      expect(o.items.every((i) => i.iconUrl)).toBe(true);
    });
    const o = objects(t.g).find((x) => x.id === out.object_id)!;
    expect(o.items.find((i) => i.name === "Gem")!.iconUrl).toMatch(/item_gem_cached\.png$/);
    expect(t.itemIcon.mock.calls.map((c) => c[1])).toEqual(["Dagger"]); // the gem came from the cache
    expect(t.g.state!.characters[0]!.inventory.find((i) => i.name === "Dagger")!.iconUrl).toMatch(/item_dagger\.png$/);
    const last = [...t.events].reverse().find((e) => e.type === "state") as { state: { mapObjects?: Obj[] } } | undefined;
    expect(last?.state.mapObjects?.find((x) => x.id === out.object_id)?.iconUrl).toMatch(/item_sack\.png$/);
  });

  it("draws nothing and still drops the loot when images are unavailable", async () => {
    const t = game({ available: false });
    await scene(t);
    const out = (await t.g.runTool("drop_loot", { x: 2, y: 3, items: [{ name: "Dagger" }] })) as { object_id: string };
    expect(out.object_id).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(t.itemIcon).not.toHaveBeenCalled();
    expect(t.lootSack).not.toHaveBeenCalled();
    expect(objects(t.g)).toHaveLength(1);
    expect(objects(t.g)[0]!.iconUrl).toBeUndefined();
  });

  it("a draw that finishes after a campaign switch does not patch the new campaign", async () => {
    const t = game();
    const { c: first } = await scene(t);
    t.setHold(true);
    await t.g.runTool("drop_loot", { x: 2, y: 3, items: [{ name: "Dagger" }] });
    await vi.waitFor(() => expect(t.itemIcon).toHaveBeenCalledTimes(1));
    const second = t.g.createCampaign({ name: "Second" });
    const pc2 = t.g.addCharacter({ name: "Thorin", maxHp: 12 });
    await t.g.runTool("give_item", { character_id: pc2.id, name: "Dagger" }, "host");
    t.setHold(false);
    t.release();
    await Promise.all(t.itemIcon.mock.results.map((r) => r.value));
    await new Promise((r) => setTimeout(r, 10));
    expect(t.g.campaign!.id).toBe(second.id);
    expect(t.g.state!.characters[0]!.inventory.find((i) => i.name === "Dagger")!.iconUrl).toBeUndefined();
    expect(first.id).not.toBe(second.id);
  });
});

describe("loot icons after undo or reload (bug loot-icons-lost-on-undo)", () => {
  it("undoing a pick_up made before the icon draws finished gives the restored loot its icons again", async () => {
    const t = game();
    const { pc } = await scene(t);
    t.setHold(true);
    const out = (await t.g.runTool("drop_loot", { x: 2, y: 3, items: [{ name: "Rusty key" }], gold: 5 })) as { object_id: string };
    await vi.waitFor(() => expect(t.itemIcon).toHaveBeenCalledTimes(1));
    await t.g.runTool("pick_up", { object_id: out.object_id, character_id: pc.id });
    expect(objects(t.g)).toHaveLength(0);
    t.setHold(false);
    t.release();
    await vi.waitFor(() => expect(t.g.state!.characters[0]!.inventory.find((i) => i.name === "Rusty key")?.iconUrl).toBeTruthy());
    t.g.undo();
    const restored = () => objects(t.g).find((x) => x.id === out.object_id)!;
    expect(restored()).toBeDefined();
    await vi.waitFor(() => {
      expect(restored().iconUrl).toMatch(/item_sack\.png$/);
      expect(restored().items[0]!.iconUrl).toMatch(/item_rusty_key\.png$/);
    });
    expect(t.itemIcon).toHaveBeenCalledTimes(1); // the key's icon came from the cache
  });

  it("loading a campaign fills loot icons that are missing (a restart mid-draw)", async () => {
    const t = game({ available: false });
    const { c } = await scene(t);
    const out = (await t.g.runTool("drop_loot", { x: 2, y: 3, items: [{ name: "Gem" }] })) as { object_id: string };
    (t.g as unknown as { images: { available: boolean } }).images.available = true;
    t.g.loadCampaign(c.id);
    await vi.waitFor(() => {
      const o = objects(t.g).find((x) => x.id === out.object_id)!;
      expect(o.iconUrl).toMatch(/item_sack\.png$/);
      expect(o.items[0]!.iconUrl).toMatch(/item_gem\.png$/);
    });
  });
});

describe("pick_up broadcast (P3)", () => {
  it("broadcasts a pickup event after a successful pick_up", async () => {
    const t = game({ available: false });
    const { pc } = await scene(t);
    const out = (await t.g.runTool("drop_loot", { x: 2, y: 3, items: [{ name: "Dagger", qty: 2 }], gold: 15 })) as { object_id: string };
    t.events.length = 0;
    await t.g.runTool("pick_up", { object_id: out.object_id, character_id: pc.id });
    const ev = t.events.find((e) => (e as { type: string }).type === "pickup") as unknown as { pickup: unknown } | undefined;
    expect(ev).toBeDefined();
    expect(ev!.pickup).toEqual({ characterId: pc.id, characterName: "Sylvaine", items: [{ name: "Dagger", qty: 2 }], gold: 15 });
    expect(JSON.stringify(t.g.state)).not.toContain('"pickup"');
  });

  it("no pickup event when pick_up fails", async () => {
    const t = game({ available: false });
    const { pc } = await scene(t);
    t.events.length = 0;
    await t.g.runTool("pick_up", { object_id: "obj_nope", character_id: pc.id }).catch(() => undefined);
    expect(t.events.some((e) => (e as { type: string }).type === "pickup")).toBe(false);
  });
});

describe("DM instructions refresh after map object changes (G2)", () => {
  it("refreshes after drop_loot, pick_up, place_interactable, set_interactable and remove_map_object", async () => {
    const t = game({ available: false });
    const { pc } = await scene(t);
    t.attachDm();
    const step = async (name: string, args: unknown) => {
      t.dm.refreshInstructions.mockClear();
      const r = await t.g.runTool(name, args);
      expect(t.dm.refreshInstructions, name).toHaveBeenCalled();
      return r as { object_id: string };
    };
    const loot = await step("drop_loot", { x: 2, y: 3, gold: 5 });
    await step("pick_up", { object_id: loot.object_id, character_id: pc.id });
    const lever = await step("place_interactable", { name: "Lever", x: 4, y: 4 });
    await step("set_interactable", { id: lever.object_id, used: true });
    await step("remove_map_object", { id: lever.object_id });
  });
});
