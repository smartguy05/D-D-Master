import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Campaign, Character, emptyGameState } from "@dm/shared";
import { Store } from "../db/index.js";
import { assetDir, buildBundle, bundleFilename, decodeBundle, encodeBundle, importBundle, rewriteMediaUrls } from "./bundle.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "dm-bundle-"));
  dirs.push(d);
  return d;
}

const OLD = "cmp_old";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function seed(dataDir: string) {
  const store = new Store(":memory:");
  const campaign = Campaign.parse({
    id: OLD,
    name: "The Sunken Chapel",
    createdAt: 1,
    updatedAt: 1,
    outline: {
      title: "The Sunken Chapel",
      locations: [{ id: "loc_nave", name: "Nave", mapUrl: `/media/${OLD}/map_abc.png` }],
    },
  });
  store.saveCampaign(campaign);
  const state = emptyGameState(OLD);
  state.locationId = "loc_nave";
  state.players.push({ id: "plr_1", name: "Sam", voiceSamples: 3 });
  state.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 7, spriteUrl: `/media/${OLD}/sprite_x.png` }));
  store.saveState(state);
  store.saveVoiceprint(OLD, "plr_1", Float32Array.from([0.25, -0.5, 1.5]), 3);
  store.appendEvent(OLD, "log", { kind: "dm", text: "Welcome" });
  const dir = assetDir(dataDir, OLD);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "map_abc.png"), PNG);
  writeFileSync(join(dir, "notes.txt"), "not exported");
  return store;
}

describe("campaign bundles", () => {
  it("round-trips export -> gzip -> import as a new campaign with rewritten ids and media URLs", () => {
    const srcDir = tmp();
    const dstDir = tmp();
    const src = seed(srcDir);
    const file = encodeBundle(buildBundle(src, srcDir, OLD));
    expect(file[0]).toBe(0x1f); // gzip magic

    const dst = new Store(":memory:");
    const imported = importBundle(dst, dstDir, decodeBundle(file), "cmp_new");
    expect(imported.id).toBe("cmp_new");
    expect(imported.name).toBe("The Sunken Chapel");
    expect(imported.outline!.locations[0].mapUrl).toBe("/media/cmp_new/map_abc.png");

    const state = dst.getState("cmp_new")!;
    expect(state.campaignId).toBe("cmp_new");
    expect(state.characters[0]).toMatchObject({ hp: 7, spriteUrl: "/media/cmp_new/sprite_x.png" });
    expect(JSON.stringify(state)).not.toContain(OLD);

    const vp = dst.getVoiceprints("cmp_new");
    expect(vp).toHaveLength(1);
    expect(vp[0].samples).toBe(3);
    expect(Array.from(vp[0].embedding)).toEqual([0.25, -0.5, 1.5]);

    expect(readFileSync(join(assetDir(dstDir, "cmp_new"), "map_abc.png"))).toEqual(PNG);
    expect(existsSync(join(assetDir(dstDir, "cmp_new"), "notes.txt"))).toBe(false);
    expect(dst.eventsSince("cmp_new", 0).map((e) => e.type)).toEqual(["log"]);
  });

  it("importing into the same store never overwrites the original", () => {
    const dir = tmp();
    const store = seed(dir);
    importBundle(store, dir, decodeBundle(encodeBundle(buildBundle(store, dir, OLD))), "cmp_copy");
    expect(store.listCampaigns().map((c) => c.id).sort()).toEqual(["cmp_copy", OLD]);
    expect(store.getCampaign(OLD)!.outline!.locations[0].mapUrl).toBe(`/media/${OLD}/map_abc.png`);
  });

  it("can omit events, accepts plain JSON, and rejects foreign files and unsafe asset names", () => {
    const dir = tmp();
    const store = seed(dir);
    const bundle = buildBundle(store, dir, OLD, { events: false });
    expect(bundle.events).toBeUndefined();
    expect(decodeBundle(Buffer.from(JSON.stringify(bundle))).campaign).toMatchObject({ id: OLD });
    expect(() => decodeBundle(gzipSync(Buffer.from(JSON.stringify({ hello: 1 }))))).toThrow(/Not a campaign export/);

    bundle.assets = { "../../evil.png": "AAAA", "ok.png": "AAAA" };
    const out = tmp();
    importBundle(new Store(":memory:"), out, bundle, "cmp_safe");
    expect(existsSync(join(out, "evil.png"))).toBe(false);
    expect(existsSync(join(assetDir(out, "cmp_safe"), "ok.png"))).toBe(true);
  });

  it("helpers", () => {
    expect(rewriteMediaUrls({ a: ["/media/x/1.png", "/media/xy/2.png"] }, "x", "z")).toEqual({ a: ["/media/z/1.png", "/media/xy/2.png"] });
    expect(bundleFilename("The Sunken Chapel (demo)")).toBe("the-sunken-chapel-demo.dmc.json.gz");
    expect(() => buildBundle(new Store(":memory:"), tmp(), "nope")).toThrow(/Unknown campaign/);
  });
});
