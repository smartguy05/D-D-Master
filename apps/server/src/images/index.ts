import OpenAI from "openai";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config.js";

/** Public URL prefix under which campaign asset files are served. */
export const ASSET_URL_PREFIX = "/media";

const MAP_STYLE =
  "Top-down orthographic tabletop RPG battle map, viewed from directly above, hand-painted fantasy style, rich detail, even lighting, no text, no labels, no grid lines, no characters or creatures, fills the whole frame.";
const SPRITE_STYLE =
  "Single full-body character miniature token art, fantasy illustration, three-quarter front view, centered, whole body visible, crisp clean edges, transparent background, no text, no frame, no ground shadow.";

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
    return this.generate(campaignId, "map", `${MAP_STYLE}\n\nScene: ${description}`, "1536x1024", false);
  }

  sprite(campaignId: string, description: string): Promise<string> {
    return this.generate(campaignId, "sprite", `${SPRITE_STYLE}\n\nSubject: ${description}`, "1024x1024", true);
  }
}
