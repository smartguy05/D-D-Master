import OpenAI from "openai";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { withDeadline, type ImageInput } from "../brain/provider.js";

/** Public URL prefix under which campaign asset files are served. */
export const ASSET_URL_PREFIX = "/media";

const MAP_STYLE =
  "Top-down orthographic tabletop RPG battle map, viewed from directly above, hand-painted fantasy style, rich detail, even lighting, no text, no labels, no grid lines, no characters or creatures, fills the whole frame.";
/**
 * The table's layout contract: the party enters at the left edge (engine `placeCharacters`) and
 * monsters spawn toward the right (`spawn_monster` default), so the painted map must match.
 */
const MAP_LAYOUT =
  "Layout: wide landscape map whose long axis runs left to right. The entrance (door, stairs, path or gate) is on the LEFT edge, near the vertical middle. The far end with the main focal feature (altar, idol, throne, lair or exit) is on the RIGHT edge. Do not put the entrance at the bottom or the focal feature at the top.";
const SPRITE_STYLE =
  "Single full-body character miniature token art, fantasy illustration, three-quarter front view, centered, whole body visible, crisp clean edges, transparent background, no text, no frame, no ground shadow.";

const ITEM_STYLE =
  "Single fantasy RPG inventory item icon, hand-painted game art, the object alone, centered, filling most of the frame, crisp clean edges, transparent background, no text, no frame, no hands, no shadow.";
/** The board marker for a loot pile (drop_loot): one picture per campaign. */
const LOOT_SACK_ITEM = "a small tied leather loot sack, bulging, a few gold coins spilling out";

export type ImageKind = "map" | "sprite" | "item";

/** Prompt for an item icon (loot, inventory): the style, then the item's name. */
export function itemIconPrompt(name: string): string {
  return `${ITEM_STYLE}\n\nItem: ${name}`;
}

/**
 * What an item icon's file name hashes: the prompt for the name trimmed and lower-cased, so
 * "Dagger", "dagger" and "Dagger " share one picture (item names match that way everywhere else).
 */
function itemIconCacheKey(name: string): string {
  return itemIconPrompt(name.trim().toLowerCase());
}

function spritePrompt(description: string): string {
  return `${SPRITE_STYLE}\n\nSubject: ${description}`;
}

/** Full image prompt for a location map: style, then the orientation contract, then the scene. */
export function buildMapPrompt(description: string): string {
  return `${MAP_STYLE}\n${MAP_LAYOUT}\n\nScene: ${description}`;
}

/**
 * Asset file name: a hash of model|size|prompt, so an unchanged prompt reuses the cached picture.
 * A `nonce` (forced repaint) gives a new name, so the host gets a new picture and a new URL.
 */
export function imageFileName(kind: ImageKind, model: string, size: string, prompt: string, nonce?: string): string {
  const hash = createHash("sha1").update(`${model}|${size}|${prompt}${nonce ? `|${nonce}` : ""}`).digest("hex").slice(0, 12);
  return `${kind}_${hash}.png`;
}

export class ImageService {
  private client?: OpenAI;

  constructor() {
    // One retry (the SDK default is 10 min x 3); generate() also caps the whole call at IMAGE_TIMEOUT_MS.
    if (config.openaiKey) this.client = new OpenAI({ apiKey: config.openaiKey, timeout: config.imageTimeoutMs, maxRetries: 1 });
  }

  get available() {
    return !!this.client;
  }

  private dir(campaignId: string) {
    const d = join(config.dataDir, campaignId, "assets");
    mkdirSync(d, { recursive: true });
    return d;
  }

  private asset(campaignId: string, kind: ImageKind, size: string, prompt: string, nonce?: string) {
    const file = imageFileName(kind, config.imageModel, size, prompt, nonce);
    return { path: join(this.dir(campaignId), file), url: `${ASSET_URL_PREFIX}/${campaignId}/${file}` };
  }

  private async generate(
    campaignId: string,
    kind: ImageKind,
    prompt: string,
    size: "1536x1024" | "1024x1024",
    transparent: boolean,
    fresh = false,
    cacheKey = prompt,
  ): Promise<string> {
    if (!this.client) throw new Error("OPENAI_API_KEY is not set; image generation is unavailable.");
    const nonce = fresh ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : undefined;
    const { path, url } = this.asset(campaignId, kind, size, cacheKey, nonce);
    if (existsSync(path)) return url; // cached

    // The whole request, its retry included, ends at IMAGE_TIMEOUT_MS: the job chip errors instead of hanging.
    const abort = new AbortController();
    const work = this.client.images.generate(
      {
        model: config.imageModel,
        prompt,
        size,
        quality: config.imageQuality,
        ...(transparent ? { background: "transparent" as const } : {}),
        n: 1,
      },
      { signal: abort.signal },
    );
    const res = await withDeadline(work, config.imageTimeoutMs, () => abort.abort(), "Image request");
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image API returned no image data");
    writeFileSync(path, Buffer.from(b64, "base64"));
    return url;
  }

  /** Paint a location map. `fresh` (a forced repaint) skips the prompt cache and gives a new URL. */
  map(campaignId: string, description: string, fresh = false): Promise<string> {
    return this.generate(campaignId, "map", buildMapPrompt(description), "1536x1024", false, fresh);
  }

  /** A saved asset (by its public `/media/...` url) as base64, for vision input. Undefined if missing. */
  readAsset(url: string): ImageInput | undefined {
    const m = new RegExp(`^${ASSET_URL_PREFIX}/([\\w-]+)/([\\w-]+\\.png)$`).exec(url);
    if (!m) return undefined;
    const path = join(config.dataDir, m[1], "assets", m[2]);
    return existsSync(path) ? { mediaType: "image/png", base64: readFileSync(path).toString("base64") } : undefined;
  }

  sprite(campaignId: string, description: string): Promise<string> {
    return this.generate(campaignId, "sprite", spritePrompt(description), "1024x1024", true);
  }

  /** A small transparent icon for an item (loot, inventory), cached per campaign by its name (any case). */
  itemIcon(campaignId: string, name: string): Promise<string> {
    return this.generate(campaignId, "item", itemIconPrompt(name.trim()), "1024x1024", true, false, itemIconCacheKey(name));
  }

  /** The url of an item icon already drawn for this name (no API call), else undefined. */
  cachedItemIcon(campaignId: string, name: string): string | undefined {
    const { path, url } = this.asset(campaignId, "item", "1024x1024", itemIconCacheKey(name));
    return existsSync(path) ? url : undefined;
  }

  /** The loot-sack marker for loot piles on the board (drawn once per campaign, then cached). */
  lootSack(campaignId: string): Promise<string> {
    return this.itemIcon(campaignId, LOOT_SACK_ITEM);
  }

  /** The url of a sprite already drawn for this description (no API call), else undefined. */
  cachedSprite(campaignId: string, description: string): string | undefined {
    const { path, url } = this.asset(campaignId, "sprite", "1024x1024", spritePrompt(description));
    return existsSync(path) ? url : undefined;
  }
}
