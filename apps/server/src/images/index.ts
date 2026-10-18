import OpenAI from "openai";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import type { ImageInput } from "../brain/provider.js";

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

/** Full image prompt for a location map: style, then the orientation contract, then the scene. */
export function buildMapPrompt(description: string): string {
  return `${MAP_STYLE}\n${MAP_LAYOUT}\n\nScene: ${description}`;
}

export class ImageService {
  private client?: OpenAI;

  constructor() {
    if (config.openaiKey) this.client = new OpenAI({ apiKey: config.openaiKey });
  }

  get available() {
    return !!this.client;
  }

  private dir(campaignId: string) {
    const d = join(config.dataDir, campaignId, "assets");
    mkdirSync(d, { recursive: true });
    return d;
  }

  private async generate(
    campaignId: string,
    kind: "map" | "sprite",
    prompt: string,
    size: "1536x1024" | "1024x1024",
    transparent: boolean,
  ): Promise<string> {
    if (!this.client) throw new Error("OPENAI_API_KEY is not set; image generation is unavailable.");
    const hash = createHash("sha1").update(`${config.imageModel}|${size}|${prompt}`).digest("hex").slice(0, 12);
    const file = `${kind}_${hash}.png`;
    const path = join(this.dir(campaignId), file);
    const url = `${ASSET_URL_PREFIX}/${campaignId}/${file}`;
    if (existsSync(path)) return url; // cached

    const res = await this.client.images.generate({
      model: config.imageModel,
      prompt,
      size,
      quality: config.imageQuality,
      ...(transparent ? { background: "transparent" as const } : {}),
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image API returned no image data");
    writeFileSync(path, Buffer.from(b64, "base64"));
    return url;
  }

  map(campaignId: string, description: string): Promise<string> {
    return this.generate(campaignId, "map", buildMapPrompt(description), "1536x1024", false);
  }

  /** A saved asset (by its public `/media/...` url) as base64, for vision input. Undefined if missing. */
  readAsset(url: string): ImageInput | undefined {
    const m = new RegExp(`^${ASSET_URL_PREFIX}/([\\w-]+)/([\\w-]+\\.png)$`).exec(url);
    if (!m) return undefined;
    const path = join(config.dataDir, m[1], "assets", m[2]);
    return existsSync(path) ? { mediaType: "image/png", base64: readFileSync(path).toString("base64") } : undefined;
  }

  sprite(campaignId: string, description: string): Promise<string> {
    return this.generate(campaignId, "sprite", `${SPRITE_STYLE}\n\nSubject: ${description}`, "1024x1024", true);
  }
}
