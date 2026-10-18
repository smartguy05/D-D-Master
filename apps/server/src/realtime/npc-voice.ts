import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { ToolArgs, type Npc } from "@dm/shared";
import { config } from "../config.js";
import { ASSET_URL_PREFIX } from "../images/index.js";
import type { NpcClip } from "./npc-queue.js";

/** Rough speaking time of a line (~15 characters per second), at least 1 s. */
export function estimateSpeechMs(line: string): number {
  return Math.max(1000, Math.round((line.length / 15) * 1000));
}

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Length of an MPEG Layer III file in ms: the Xing/Info frame count when present, otherwise CBR
 * from the first frame's bitrate. Undefined if no frame header is found.
 */
export function mp3DurationMs(buf: Uint8Array): number | undefined {
  let off = 0;
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    off = 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  for (const end = Math.min(buf.length - 4, off + 4096); off <= end; off++) {
    if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) continue;
    const version = (buf[off + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layer = (buf[off + 1] >> 1) & 3; // 1 = Layer III
    const bitrateIdx = buf[off + 2] >> 4;
    const rateIdx = (buf[off + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) continue;
    const kbps = (version === 3 ? MP3_BITRATES_V1_L3 : MP3_BITRATES_V2_L3)[bitrateIdx];
    const rate = MP3_RATES[version][rateIdx];
    const mono = buf[off + 3] >> 6 === 3;
    const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = off + 4 + sideInfo;
    const tag = String.fromCharCode(...buf.subarray(x, x + 4));
    if ((tag === "Xing" || tag === "Info") && buf[x + 7] & 1) {
      const frames = ((buf[x + 8] << 24) | (buf[x + 9] << 16) | (buf[x + 10] << 8) | buf[x + 11]) >>> 0;
      const samplesPerFrame = version === 3 ? 1152 : 576;
      return Math.round((frames * samplesPerFrame * 1000) / rate);
    }
    return Math.round(((buf.length - off) * 8) / kbps);
  }
  return undefined;
}

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

  /** Synthesize (or reuse) the clip; returns its URL and length in ms. */
  async synthesize(campaignId: string, npc: Pick<Npc, "name" | "voice">, line: string, style?: string): Promise<{ url: string; durationMs: number }> {
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
    const durationMs = mp3DurationMs(readFileSync(path)) ?? estimateSpeechMs(line);
    return { url: `${this.opts.urlPrefix}/${campaignId}/${file}`, durationMs };
  }
}

export interface SpeakAsNpcContext {
  campaignId: string;
  npcs: Npc[];
  voice: NpcVoice;
  /** Queue the clip on the table speaker (NpcClipQueue: after the DM stops talking, one at a time). */
  play(clip: NpcClip): void;
  log(speaker: string, text: string): void;
}

/** The speak_as_npc tool: validate, synthesize, queue for the table, and tell the DM what happened. */
export async function speakAsNpc(args: unknown, ctx: SpeakAsNpcContext) {
  const a = ToolArgs.speak_as_npc.parse(args ?? {});
  if (!ctx.voice.available) return { ok: false, error: "NPC voices are off. Speak the line yourself in character." };
  const wanted = a.npc_name.trim().toLowerCase();
  const npc = ctx.npcs.find((n) => n.name.toLowerCase() === wanted) ?? { name: a.npc_name.trim(), voice: "" };
  const { url, durationMs } = await ctx.voice.synthesize(ctx.campaignId, npc, a.line, a.style);
  ctx.play({ npcName: npc.name, line: a.line, url, durationMs });
  ctx.log(npc.name, a.line);
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return {
    ok: true,
    playing: `${npc.name}'s line plays on the table speaker right after you stop talking (~${seconds}s). Do not repeat it or keep talking; you will be asked to continue once it has played.`,
  };
}

/** NpcVoice from config: enabled only with NPC_TTS=1 and an OpenAI key. */
export function createNpcVoice(): NpcVoice {
  const client = config.npcTts && config.openaiKey ? (new OpenAI({ apiKey: config.openaiKey }) as unknown as SpeechClient) : undefined;
  return new NpcVoice(client, { model: config.npcTtsModel, dmVoice: config.realtimeVoice, dataDir: config.dataDir, urlPrefix: ASSET_URL_PREFIX });
}
