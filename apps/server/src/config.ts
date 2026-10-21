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

/** A TCP port: 0 (off) to 65535; empty or junk uses the fallback. */
function portOr(raw: string | undefined, fallback: number): number {
  const n = raw?.trim() ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : fallback;
}

/** An on-by-default switch: unset or empty is on; only 0/false/no/off (any case, trimmed) turn it off. */
export function onUnlessOff(raw: string | undefined): boolean {
  return !/^(0|false|no|off)$/i.test((raw ?? "").trim());
}

/** setTimeout's largest delay. */
const MAX_TIMER_MS = 2_147_483_647;

export const config = {
  port: parseInt(env.PORT ?? "8787", 10),
  /** Second listener over HTTPS (browsers only allow the mic on https or localhost). 0 turns it off. */
  httpsPort: portOr(env.HTTPS_PORT, 8443),
  /** A user-supplied certificate (e.g. mkcert); both must be set, else a self-signed one is made in <dataDir>/certs. */
  httpsCert: (env.HTTPS_CERT ?? "").trim(),
  httpsKey: (env.HTTPS_KEY ?? "").trim(),
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
  /** consult_brain (the DM waits on it mid-conversation): a slow planner answer becomes "improvise" instead of a stall. */
  consultTimeoutMs: Math.min(msOr(env.CONSULT_TIMEOUT_MS, 30_000) || MAX_TIMER_MS, MAX_TIMER_MS),
  /** OpenAI reasoning effort for brain calls (minimal|low|medium|high); unset = the model's default. */
  brainReasoningEffort: env.BRAIN_REASONING_EFFORT?.trim() || undefined,

  /** AI players: their own fast model and short timeout (they answer mid-conversation). */
  aiPlayerProvider: (env.AI_PLAYER_PROVIDER?.trim() || env.BRAIN_PROVIDER || "openai") as "openai" | "anthropic",
  aiPlayerModelOpenai: env.AI_PLAYER_MODEL_OPENAI ?? "gpt-5-mini",
  aiPlayerModelAnthropic: env.AI_PLAYER_MODEL_ANTHROPIC ?? "claude-haiku-5-5",
  aiPlayerTimeoutMs: Math.min(msOr(env.AI_PLAYER_TIMEOUT_MS, 20_000) || MAX_TIMER_MS, MAX_TIMER_MS),
  /** Least time between two unprompted AI player lines (exploration and roleplay). */
  aiPlayerCooldownMs: msOr(env.AI_PLAYER_SPONTANEOUS_COOLDOWN_MS, 90_000),

  realtimeModel: env.REALTIME_MODEL ?? "gpt-realtime",
  realtimeVoice: env.REALTIME_VOICE ?? "cedar",
  transcribeModel: env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe",

  /**
   * Noise-turn gate: hold the reply to a voice turn until its transcript arrives and skip turns
   * that are only coughs/fillers (on by default). The timeout answers anyway if no transcript comes.
   */
  turnGate: !/^(0|false|no|off|disabled|none)$/i.test((env.TURN_GATE ?? "on").trim()),
  turnGateTimeoutMs: msOr(env.TURN_GATE_TIMEOUT_MS, 1200),

  /**
   * Realtime calls end at 60 min. Past AFTER the server renews the call at a quiet moment (a silent
   * make-before-break handover); at DEADLINE it swaps as soon as the DM isn't speaking.
   */
  voiceHandoverAfterMs: Math.min(msOr(env.VOICE_HANDOVER_AFTER_MS, 3_000_000) || MAX_TIMER_MS, MAX_TIMER_MS),
  voiceHandoverDeadlineMs: Math.min(msOr(env.VOICE_HANDOVER_DEADLINE_MS, 3_420_000) || MAX_TIMER_MS, MAX_TIMER_MS),

  /** speak_as_npc tool: NPC lines in their own voice via the speech API. On by default (NPC_TTS=0 turns it off); needs OPENAI_API_KEY. */
  npcTts: onUnlessOff(env.NPC_TTS),
  npcTtsModel: env.NPC_TTS_MODEL ?? "gpt-4o-mini-tts",
  /** One speech request (per attempt, one retry): a stalled one must not leave an NPC or AI player line hanging. */
  npcTtsTimeoutMs: Math.min(msOr(env.NPC_TTS_TIMEOUT_MS, 15_000) || MAX_TIMER_MS, MAX_TIMER_MS),

  imageModel: env.IMAGE_MODEL ?? "gpt-image-1",
  imageQuality: (env.IMAGE_QUALITY ?? "medium") as "low" | "medium" | "high",
  /** One image request, its retry included: a stalled one errors the job chip instead of hanging. */
  imageTimeoutMs: Math.min(msOr(env.IMAGE_TIMEOUT_MS, 300_000) || MAX_TIMER_MS, MAX_TIMER_MS),
  /** Paint the next unpainted outline location in the background when the party arrives somewhere. */
  prepaintMaps: !/^(0|false|no|off|disabled|none)$/i.test((env.PREPAINT_MAPS ?? "on").trim()),

  speakerModel: rootPath(env.SPEAKER_MODEL ?? "models/wespeaker_en_voxceleb_resnet34.onnx"),
  speakerThreshold: parseFloat(env.SPEAKER_THRESHOLD ?? "0.45"),
};

export type Config = typeof config;
