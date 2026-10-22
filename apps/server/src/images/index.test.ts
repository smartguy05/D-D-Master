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

describe("image request timeout (IMAGE_TIMEOUT_MS)", () => {
  const dataDir = config.dataDir;
  const timeout = config.imageTimeoutMs;
  afterEach(() => {
    config.dataDir = dataDir;
    config.imageTimeoutMs = timeout;
    vi.useRealTimers();
  });

  it("a stalled request rejects at the deadline and is aborted", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "dm-img-"));
    config.dataDir = dir;
    config.imageTimeoutMs = 300_000;
    const svc = new ImageService();
    let signal: AbortSignal | undefined;
    const generate = vi.fn((_req: unknown, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => undefined); // never answers
    });
    (svc as unknown as { client: unknown }).client = { images: { generate } };
    const p = svc.map("c1", "a nave");
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Image request timed out after 300s.");
    expect(signal?.aborted).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a request that answers in time is not affected", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "dm-img-"));
    config.dataDir = dir;
    config.imageTimeoutMs = 1_000;
    const svc = new ImageService();
    const generate = vi.fn(async () => ({ data: [{ b64_json: Buffer.from("png").toString("base64") }] }));
    (svc as unknown as { client: unknown }).client = { images: { generate } };
    await expect(svc.map("c1", "a nave")).resolves.toMatch(/map_[0-9a-f]{12}\.png$/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("ImageService.sprite and the safety filter", () => {
  const dataDir = config.dataDir;
  afterEach(() => {
    config.dataDir = dataDir;
  });
  const blocked = Object.assign(new Error("400 Your request was rejected by the safety system."), { status: 400, code: "moderation_blocked" });
  const subject = "Pippa Candlewick, a Halfling Cleric. A halfling in a white bedsheet ghost costume with eyeholes and a pointy hood.";

  function service(refuse: (prompt: string) => boolean) {
    const dir = mkdtempSync(join(tmpdir(), "dm-img-"));
    config.dataDir = dir;
    const svc = new ImageService();
    const generate = vi.fn(async ({ prompt }: { prompt: string }) => {
      if (refuse(prompt)) throw blocked;
      return { data: [{ b64_json: Buffer.from("png").toString("base64") }] };
    });
    (svc as unknown as { client: unknown }).client = { images: { generate } };
    return { svc, generate, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it("retries a refused subject with the rewritten words and caches it under the original", async () => {
    const { svc, generate, cleanup } = service((p) => p.includes("pointy hood"));
    const rewrite = vi.fn(async () => "Pippa Candlewick, a Halfling Cleric in a cute round cartoon ghost costume.");
    const url = await svc.sprite("c1", subject, rewrite);
    expect(rewrite).toHaveBeenCalledWith(subject);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(svc.cachedSprite("c1", subject)).toBe(url);
    cleanup();
  });

  it("falls back to the plain first sentence when the rewrite is refused too", async () => {
    const { svc, generate, cleanup } = service((p) => p.includes("ghost"));
    await svc.sprite("c1", subject, async () => "Pippa in a ghost costume");
    expect(String(generate.mock.calls.at(-1)![0].prompt)).toMatch(/Subject: Pippa Candlewick, a Halfling Cleric\.$/);
    cleanup();
  });

  it("throws a readable error when every wording is refused, and rethrows other errors as they are", async () => {
    const all = service(() => true);
    await expect(all.svc.sprite("c1", subject)).rejects.toThrow(/safety filter/);
    all.cleanup();
    const { svc, generate, cleanup } = service(() => false);
    generate.mockRejectedValueOnce(new Error("timeout"));
    await expect(svc.sprite("c1", subject)).rejects.toThrow("timeout");
    expect(generate).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

describe("isModerationError", () => {
  it("tells a safety refusal from other failures", async () => {
    const { isModerationError } = await import("./index.js");
    expect(isModerationError({ status: 400, code: "moderation_blocked" })).toBe(true);
    expect(isModerationError({ status: 400, error: { code: "content_policy_violation" } })).toBe(true);
    expect(isModerationError({ status: 400, message: "rejected by the safety system" })).toBe(true);
    expect(isModerationError({ status: 400, message: "invalid size" })).toBe(false);
    expect(isModerationError(new Error("timeout"))).toBe(false);
  });
});
