import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { Campaign, GameState } from "@dm/shared";
import type { Store } from "../db/index.js";
import { ASSET_URL_PREFIX } from "../images/index.js";

/**
 * Single-file campaign archive (`<name>.dmc.json.gz`): gzip of one JSON object holding the campaign,
 * its game state, voiceprints (base64 Float32), an optional capped tail of the event log, and every
 * generated image under `<dataDir>/<id>/assets` (base64 PNG). Undo history is not exported.
 */
export const BUNDLE_FORMAT = "dm-campaign";
export const BUNDLE_VERSION = 1;
/** Most recent events included in an export. */
export const BUNDLE_MAX_EVENTS = 5000;
/** Largest accepted upload (the HTTP route uses this as its bodyLimit). */
export const BUNDLE_MAX_BYTES = 200 * 1024 * 1024;

const ASSET_FILE = /^[\w.-]+\.png$/;

export const CampaignBundle = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  exportedAt: z.number().default(0),
  campaign: z.unknown(),
  state: z.unknown().optional(),
  voiceprints: z.array(z.object({ playerId: z.string(), samples: z.number().int(), embedding: z.string() })).default([]),
  events: z.array(z.object({ ts: z.number(), type: z.string(), payload: z.unknown() })).optional(),
  assets: z.record(z.string()).default({}),
});
export type CampaignBundle = z.infer<typeof CampaignBundle>;

export function assetDir(dataDir: string, campaignId: string) {
  return join(dataDir, campaignId, "assets");
}

/** Collect everything about one campaign into a bundle object. */
export function buildBundle(store: Store, dataDir: string, campaignId: string, opts: { events?: boolean } = {}): CampaignBundle {
  const campaign = store.getCampaign(campaignId);
  if (!campaign) throw new Error(`Unknown campaign ${campaignId}`);
  const voiceprints = store.getVoiceprints(campaignId).map((v) => ({
    playerId: v.playerId,
    samples: v.samples,
    embedding: Buffer.from(v.embedding.buffer, v.embedding.byteOffset, v.embedding.byteLength).toString("base64"),
  }));
  const assets: Record<string, string> = {};
  const dir = assetDir(dataDir, campaignId);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (ASSET_FILE.test(f)) assets[f] = readFileSync(join(dir, f)).toString("base64");
  }
  let events: CampaignBundle["events"];
  if (opts.events !== false) {
    const rows = store.db
      .prepare("SELECT ts, type, payload FROM events WHERE campaign_id = ? ORDER BY id DESC LIMIT ?")
      .all(campaignId, BUNDLE_MAX_EVENTS) as { ts: number; type: string; payload: string }[];
    events = rows.reverse().map((r) => ({ ts: r.ts, type: r.type, payload: JSON.parse(r.payload) }));
  }
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    campaign,
    state: store.getState(campaignId),
    voiceprints,
    events,
    assets,
  };
}

export function encodeBundle(bundle: CampaignBundle): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(bundle)));
}

/** Accepts the gzipped file, plain JSON bytes, or an already-parsed object. */
export function decodeBundle(input: Buffer | string | object): CampaignBundle {
  let raw: unknown = input;
  if (Buffer.isBuffer(input)) {
    const bytes = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input, { maxOutputLength: BUNDLE_MAX_BYTES * 2 }) : input;
    raw = JSON.parse(bytes.toString("utf8"));
  } else if (typeof input === "string") {
    raw = JSON.parse(input);
  }
  const parsed = CampaignBundle.safeParse(raw);
  if (!parsed.success) throw new Error(`Not a campaign export (${parsed.error.issues[0]?.path.join(".") || "format"}: ${parsed.error.issues[0]?.message})`);
  return parsed.data;
}

/** Replace `/media/<oldId>/` with `/media/<newId>/` anywhere inside a JSON-able value. */
export function rewriteMediaUrls<T>(value: T, oldId: string, newId: string): T {
  if (value === undefined) return value;
  const from = `${ASSET_URL_PREFIX}/${oldId}/`;
  const to = `${ASSET_URL_PREFIX}/${newId}/`;
  return JSON.parse(JSON.stringify(value).split(from).join(to)) as T;
}

/**
 * Write a bundle into the store as a NEW campaign with id `newId`: campaign + state rows with the id
 * and media URLs rewritten, voiceprints, events and asset files. Returns the new campaign.
 */
export function importBundle(store: Store, dataDir: string, bundle: CampaignBundle, newId: string): Campaign {
  const src = Campaign.parse(bundle.campaign);
  const oldId = src.id;
  const now = Date.now();
  const campaign = Campaign.parse({ ...rewriteMediaUrls(src, oldId, newId), id: newId, updatedAt: now });
  const state = GameState.parse({ ...(rewriteMediaUrls(bundle.state ?? {}, oldId, newId) as object), campaignId: newId });

  const files = Object.entries(bundle.assets).filter(([name]) => ASSET_FILE.test(name));
  const tx = store.db.transaction(() => {
    store.saveCampaign(campaign);
    store.saveState(state);
    for (const v of bundle.voiceprints) {
      // Copy into a fresh ArrayBuffer: pooled Buffers can have an offset that isn't 4-byte aligned.
      const bytes = new Uint8Array(Buffer.from(v.embedding, "base64"));
      store.saveVoiceprint(newId, v.playerId, new Float32Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 4)), v.samples);
    }
    const ins = store.db.prepare("INSERT INTO events (campaign_id, ts, type, payload) VALUES (?, ?, ?, ?)");
    for (const e of bundle.events ?? []) ins.run(newId, e.ts, e.type, JSON.stringify(rewriteMediaUrls(e.payload, oldId, newId) ?? null));
  });
  tx();
  if (files.length) {
    const dir = assetDir(dataDir, newId);
    mkdirSync(dir, { recursive: true });
    for (const [name, b64] of files) writeFileSync(join(dir, name), Buffer.from(b64, "base64"));
  }
  return campaign;
}

/** A download filename like `the-sunken-chapel.dmc.json.gz`. */
export function bundleFilename(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "campaign";
  return `${slug}.dmc.json.gz`;
}
