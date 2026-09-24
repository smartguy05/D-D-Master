import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";

export const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const env = process.env;
const rootPath = (p: string) => (isAbsolute(p) ? p : join(ROOT, p));

export const config = {
  port: parseInt(env.PORT ?? "8787", 10),
  dataDir: rootPath(env.DATA_DIR ?? "campaigns"),
  srdDir: join(ROOT, "data/srd"),
  customRulesDir: join(ROOT, "rules/custom"),
  webDist: join(ROOT, "apps/web/dist"),

  openaiKey: env.OPENAI_API_KEY ?? "",
  anthropicKey: env.ANTHROPIC_API_KEY ?? "",

  brainProvider: (env.BRAIN_PROVIDER ?? "openai") as "openai" | "anthropic",
  brainModelOpenai: env.BRAIN_MODEL_OPENAI ?? "gpt-5",
  brainModelAnthropic: env.BRAIN_MODEL_ANTHROPIC ?? "claude-opus-5",

  realtimeModel: env.REALTIME_MODEL ?? "gpt-realtime",
  realtimeVoice: env.REALTIME_VOICE ?? "cedar",
  transcribeModel: env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe",

  imageModel: env.IMAGE_MODEL ?? "gpt-image-1",
  imageQuality: (env.IMAGE_QUALITY ?? "medium") as "low" | "medium" | "high",

  speakerModel: rootPath(env.SPEAKER_MODEL ?? "models/wespeaker_en_voxceleb_resnet34.onnx"),
  speakerThreshold: parseFloat(env.SPEAKER_THRESHOLD ?? "0.45"),
};

export type Config = typeof config;
