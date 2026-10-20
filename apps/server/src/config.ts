import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";

export const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const env = process.env;
const rootPath = (p: string) => (isAbsolute(p) ? p : join(ROOT, p));
/** A millisecond setting: 0 is valid, negatives clamp to 0, empty or junk uses the fallback. */
function msOr(raw: string | undefined, fallback: number): number {
  const n = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

/** setTimeout's largest delay. */
const MAX_TIMER_MS = 2_147_483_647;

export const config = {
  port: parseInt(env.PORT ?? "8787", 10),
  /** Base URL phones should open (QR codes, player links), e.g. http://192.168.1.20:8787. Empty = the LAN IP. */
  publicUrl: (env.PUBLIC_URL ?? "").trim(),
  dataDir: rootPath(env.DATA_DIR ?? "campaigns"),
  srdDir: join(ROOT, "data/srd"),
  customRulesDir: join(ROOT, "rules/custom"),
  webDist: join(ROOT, "apps/web/dist"),

  openaiKey: env.OPENAI_API_KEY ?? "",
  anthropicKey: env.ANTHROPIC_API_KEY ?? "",

  brainProvider: (env.BRAIN_PROVIDER ?? "openai") as "openai" | "anthropic",
  brainModelOpenai: env.BRAIN_MODEL_OPENAI ?? "gpt-5",
  brainModelAnthropic: env.BRAIN_MODEL_ANTHROPIC ?? "claude-opus-5",
  /** Per brain request (adventure, pregens, sheets, map reading): a hung call fails instead of waiting 10+ min. */
  // 0 = no limit; capped at setTimeout's maximum (~24.8 days; larger values fire at once, and so does 0).
  brainTimeoutMs: Math.min(msOr(env.BRAIN_TIMEOUT_MS, 900_000) || MAX_TIMER_MS, MAX_TIMER_MS),
  /** OpenAI reasoning effort for brain calls (minimal|low|medium|high); unset = the model's default. */
  brainReasoningEffort: env.BRAIN_REASONING_EFFORT?.trim() || undefined,

  realtimeModel: env.REALTIME_MODEL ?? "gpt-realtime",
  realtimeVoice: env.REALTIME_VOICE ?? "cedar",
  transcribeModel: env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe",

  /**
   * Noise-turn gate: hold the reply to a voice turn until its transcript arrives and skip turns
   * that are only coughs/fillers (on by default). The timeout answers anyway if no transcript comes.
   */
  turnGate: !/^(0|false|no|off|disabled|none)$/i.test((env.TURN_GATE ?? "on").trim()),
  turnGateTimeoutMs: msOr(env.TURN_GATE_TIMEOUT_MS, 1200),

  /** Optional speak_as_npc tool: synthesize short NPC lines with the speech API (off by default). */
  npcTts: /^(1|true|yes|on)$/i.test(env.NPC_TTS ?? ""),
  npcTtsModel: env.NPC_TTS_MODEL ?? "gpt-4o-mini-tts",

  imageModel: env.IMAGE_MODEL ?? "gpt-image-1",
  imageQuality: (env.IMAGE_QUALITY ?? "medium") as "low" | "medium" | "high",
  /** Paint the next unpainted outline location in the background when the party arrives somewhere. */
  prepaintMaps: !/^(0|false|no|off|disabled|none)$/i.test((env.PREPAINT_MAPS ?? "on").trim()),

  speakerModel: rootPath(env.SPEAKER_MODEL ?? "models/wespeaker_en_voxceleb_resnet34.onnx"),
  speakerThreshold: parseFloat(env.SPEAKER_THRESHOLD ?? "0.45"),
};

export type Config = typeof config;
