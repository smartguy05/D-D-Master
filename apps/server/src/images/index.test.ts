import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { buildMapPrompt, imageFileName, ImageService } from "./index.js";

describe("buildMapPrompt", () => {
  it("pins the map orientation to the table's left-to-right layout", () => {
    const p = buildMapPrompt("Chapel Nave. Broken pews, an idol behind the altar.");
    expect(p).toMatch(/entrance[^.]*LEFT edge/i);
    expect(p).toMatch(/RIGHT edge/);
    expect(p).toMatch(/left to right/i);
  });

  it("keeps the scene description after the style and layout", () => {
    const p = buildMapPrompt("Drowned Crypt. Black water between sarcophagi.");
    expect(p.endsWith("Scene: Drowned Crypt. Black water between sarcophagi.")).toBe(true);
    expect(p).toMatch(/^Top-down orthographic/);
  });
});

describe("imageFileName", () => {
  it("is stable for the same prompt (cache) and new for a fresh repaint", () => {
    const a = imageFileName("map", "m", "1536x1024", "a nave");
    expect(imageFileName("map", "m", "1536x1024", "a nave")).toBe(a);
    expect(a).toMatch(/^map_[0-9a-f]{12}\.png$/);
    const fresh = imageFileName("map", "m", "1536x1024", "a nave", "n1");
    expect(fresh).not.toBe(a);
    expect(imageFileName("map", "m", "1536x1024", "a nave", "n2")).not.toBe(fresh);
  });
});

describe("ImageService.map caching", () => {
  const dataDir = config.dataDir;
  afterEach(() => {
    config.dataDir = dataDir;
  });

  function service() {
    const dir = mkdtempSync(join(tmpdir(), "dm-img-"));
    config.dataDir = dir;
    const svc = new ImageService();
    const generate = vi.fn(async () => ({ data: [{ b64_json: Buffer.from("png").toString("base64") }] }));
    (svc as unknown as { client: unknown }).client = { images: { generate } };
    return { svc, generate, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it("reuses the cached picture for the same prompt", async () => {
    const { svc, generate, cleanup } = service();
    const a = await svc.map("c1", "a nave");
    expect(await svc.map("c1", "a nave")).toBe(a);
    expect(generate).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("a fresh (forced) repaint of the same prompt paints a new picture with a new URL every time", async () => {
    const { svc, generate, cleanup } = service();
    const a = await svc.map("c1", "a nave");
    const b = await svc.map("c1", "a nave", true);
    const c = await svc.map("c1", "a nave", true);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(generate).toHaveBeenCalledTimes(3);
    cleanup();
  });
});

describe("item icons (M1)", () => {
  const dataDir = config.dataDir;
  afterEach(() => {
    config.dataDir = dataDir;
  });

  type ItemImages = {
    itemIcon(campaignId: string, name: string): Promise<string>;
    cachedItemIcon(campaignId: string, name: string): string | undefined;
    lootSack(campaignId: string): Promise<string>;
  };

  function service(withClient = true) {
    const dir = mkdtempSync(join(tmpdir(), "dm-img-"));
    config.dataDir = dir;
    const svc = new ImageService();
    const generate = vi.fn(async (_req: Record<string, unknown>) => ({ data: [{ b64_json: Buffer.from("png").toString("base64") }] }));
    (svc as unknown as { client: unknown }).client = withClient ? { images: { generate } } : undefined;
    return { svc: svc as unknown as ItemImages, generate, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it("imageFileName accepts the item kind", () => {
    const f = (imageFileName as unknown as (k: string, m: string, s: string, p: string) => string)("item", "m", "1024x1024", "dagger icon");
    expect(f).toMatch(/^item_[0-9a-f]{12}\.png$/);
    expect((imageFileName as unknown as (k: string, m: string, s: string, p: string) => string)("item", "m", "1024x1024", "dagger icon")).toBe(f);
  });

  it("itemIconPrompt names the item and asks for a centered transparent icon without text", async () => {
    const mod = (await import("./index.js")) as unknown as { itemIconPrompt?: (name: string) => string };
    expect(typeof mod.itemIconPrompt).toBe("function");
    const p = mod.itemIconPrompt!("Silver Dagger");
    expect(p).toContain("Silver Dagger");
    for (const w of ["icon", "centered", "no text", "transparent background"]) expect(p.toLowerCase()).toContain(w);
  });

  it("draws an item icon once (1024x1024, transparent) and serves it from the cache", async () => {
    const { svc, generate, cleanup } = service();
    expect(svc.cachedItemIcon("c1", "Dagger")).toBeUndefined();
    const url = await svc.itemIcon("c1", "Dagger");
    expect(url).toMatch(/item_[0-9a-f]{12}\.png$/);
    expect(await svc.itemIcon("c1", "Dagger")).toBe(url);
    expect(generate).toHaveBeenCalledTimes(1);
    const req = generate.mock.calls[0]![0];
    expect(req).toMatchObject({ size: "1024x1024", background: "transparent" });
    expect(String(req.prompt)).toContain("Dagger");
    expect(svc.cachedItemIcon("c1", "Dagger")).toBe(url);
    expect(generate).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("caches by item name ignoring case and surrounding spaces, like the service's draw dedupe", async () => {
    // Bug item-icon-cache-case-sensitive: "dagger" after "Dagger" was a second paid draw.
    const { svc, generate, cleanup } = service();
    const url = await svc.itemIcon("c1", "Dagger");
    expect(svc.cachedItemIcon("c1", "dagger")).toBe(url);
    expect(svc.cachedItemIcon("c1", " DAGGER ")).toBe(url);
    expect(await svc.itemIcon("c1", "dagger ")).toBe(url);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(String(generate.mock.calls[0]![0].prompt)).toContain("Item: Dagger"); // the prompt keeps the name as written
    expect(await svc.itemIcon("c1", "Silver Dagger")).not.toBe(url);
    cleanup();
  });

  it("draws the loot sack once per campaign", async () => {
    const { svc, generate, cleanup } = service();
    const a = await svc.lootSack("c1");
    expect(await svc.lootSack("c1")).toBe(a);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(a).toMatch(/item_[0-9a-f]{12}\.png$/);
    cleanup();
  });

  it("rejects without an API key", async () => {
    const { svc, cleanup } = service(false);
    await expect(svc.itemIcon("c1", "Dagger")).rejects.toThrow(/OPENAI_API_KEY is not set/);
    cleanup();
  });
});
