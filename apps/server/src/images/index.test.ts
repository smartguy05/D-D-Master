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
