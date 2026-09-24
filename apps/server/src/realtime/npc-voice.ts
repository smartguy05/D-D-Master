import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { ToolArgs, type Npc, type ServerEvent } from "@dm/shared";
import { config } from "../config.js";
import { ASSET_URL_PREFIX } from "../images/index.js";

/** The part of the openai client used here (`client.audio.speech.create`). */
export interface SpeechClient {
  audio: {
    speech: {
      create(params: {
        model: string;
        voice: string;
        input: string;
        instructions?: string;
        response_format?: "mp3";
      }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
    };
  };
}

/** Built-in speech voices (openai SDK v7 `SpeechCreateParams.voice`). */
export const NPC_TTS_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"] as const;

/** Stable voice per NPC name, never the DM's own Realtime voice. */
export function pickNpcVoice(npcName: string, dmVoice: string): string {
  const pool = NPC_TTS_VOICES.filter((v) => v !== dmVoice);
  const h = createHash("sha1").update(npcName.trim().toLowerCase()).digest();
  return pool[h.readUInt32BE(0) % pool.length];
}

export interface NpcVoiceOptions {
  model: string;
  dmVoice: string;
  /** Campaign data root: files go to `<dataDir>/<campaignId>/assets/`. */
  dataDir: string;
  /** Public URL prefix for campaign assets (e.g. "/media"). */
  urlPrefix: string;
}

/** Synthesizes short NPC lines to mp3 files that /table plays. */
export class NpcVoice {
  constructor(
    private client: SpeechClient | undefined,
    private opts: NpcVoiceOptions,
  ) {}

  get available() {
    return !!this.client;
  }

  async synthesize(campaignId: string, npc: Pick<Npc, "name" | "voice">, line: string, style?: string): Promise<string> {
    if (!this.client) throw new Error("NPC voices are unavailable (set OPENAI_API_KEY and NPC_TTS=1).");
    const voice = pickNpcVoice(npc.name, this.opts.dmVoice);
    const instructions =
      [npc.voice, style]
        .map((x) => x?.trim())
        .filter(Boolean)
        .join(". ") || "Speak in character, expressive and natural.";
    const hash = createHash("sha1").update(`${this.opts.model}|${voice}|${instructions}|${line}`).digest("hex").slice(0, 12);
    const file = `npc_${hash}.mp3`;
    const dir = join(this.opts.dataDir, campaignId, "assets");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, file);
    if (!existsSync(path)) {
      const res = await this.client.audio.speech.create({ model: this.opts.model, voice, input: line, instructions, response_format: "mp3" });
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    }
    return `${this.opts.urlPrefix}/${campaignId}/${file}`;
  }
}

export interface SpeakAsNpcContext {
  campaignId: string;
  npcs: Npc[];
  voice: NpcVoice;
  broadcast(ev: ServerEvent): void;
  log(speaker: string, text: string): void;
}

/** The speak_as_npc tool: validate, synthesize, broadcast, and tell the DM what happened. */
export async function speakAsNpc(args: unknown, ctx: SpeakAsNpcContext) {
  const a = ToolArgs.speak_as_npc.parse(args ?? {});
  if (!ctx.voice.available) return { ok: false, error: "NPC voices are off. Speak the line yourself in character." };
  const wanted = a.npc_name.trim().toLowerCase();
  const npc = ctx.npcs.find((n) => n.name.toLowerCase() === wanted) ?? { name: a.npc_name.trim(), voice: "" };
  const url = await ctx.voice.synthesize(ctx.campaignId, npc, a.line, a.style);
  ctx.broadcast({ type: "npc_speech", npcName: npc.name, line: a.line, url });
  ctx.log(npc.name, a.line);
  // Roughly 15 characters per second of speech.
  const seconds = Math.max(1, Math.round(a.line.length / 15));
  return { ok: true, playing: `${npc.name}'s line is playing on the table speaker (~${seconds}s). Do not repeat it; wait, then continue.` };
}

/** NpcVoice from config: enabled only with NPC_TTS=1 and an OpenAI key. */
export function createNpcVoice(): NpcVoice {
  const client = config.npcTts && config.openaiKey ? (new OpenAI({ apiKey: config.openaiKey }) as unknown as SpeechClient) : undefined;
  return new NpcVoice(client, { model: config.npcTtsModel, dmVoice: config.realtimeVoice, dataDir: config.dataDir, urlPrefix: ASSET_URL_PREFIX });
}
