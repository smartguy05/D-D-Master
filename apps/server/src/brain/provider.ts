import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodType, ZodTypeDef } from "zod";
import { config } from "../config.js";

export interface ImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
}

export interface CompleteOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Images shown to the model before the prompt (both providers accept vision input). */
  images?: ImageInput[];
}

/**
 * The "brain": a background text LLM used for planning, parsing and summaries.
 * Swappable between OpenAI and Anthropic with BRAIN_PROVIDER.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(opts: CompleteOptions): Promise<string>;
}

/** Client settings for brain calls: fail after BRAIN_TIMEOUT_MS (or `timeoutMs`), retry once (the SDK default is 10 min × 3). */
export function brainClientOptions(timeoutMs = config.brainTimeoutMs): { timeout: number; maxRetries: number } {
  return { timeout: timeoutMs, maxRetries: 1 };
}

/** OpenAI reasoning effort (BRAIN_REASONING_EFFORT, or `effort`), when set. */
export function reasoningParam(effort = config.brainReasoningEffort): { reasoning?: { effort: string } } {
  return effort ? { reasoning: { effort } } : {};
}

/** Per-provider overrides (AI players use a short timeout and low reasoning effort). */
export interface ProviderSettings {
  timeoutMs?: number;
  reasoningEffort?: string;
}

/**
 * Reject when `work` takes longer than `ms` (calling `onTimeout`, e.g. to abort a stream). The
 * Anthropic SDK's own timeout stops at the response headers, so a stalled stream would hang.
 * `what` names the request in the error ("Brain request", "Speech request").
 */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => void, what = "Brain request"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s.`));
      try {
        onTimeout();
      } catch {
        // aborting failed: the request already counts as timed out
      }
    }, ms);
    work.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;
  constructor(
    readonly model: string,
    apiKey: string,
    private settings: ProviderSettings = {},
  ) {
    this.client = new OpenAI({ apiKey, ...brainClientOptions(settings.timeoutMs) });
  }
  async complete({ system, prompt, maxTokens = 16000, images = [] }: CompleteOptions): Promise<string> {
    const res = await this.client.responses.create({
      model: this.model,
      instructions: system,
      input: images.length
        ? [
            {
              role: "user",
              content: [
                ...images.map((i) => ({ type: "input_image" as const, image_url: `data:${i.mediaType};base64,${i.base64}`, detail: "high" as const })),
                { type: "input_text" as const, text: prompt },
              ],
            },
          ]
        : prompt,
      max_output_tokens: maxTokens,
      ...(reasoningParam(this.settings.reasoningEffort ?? config.brainReasoningEffort) as Record<string, never>),
    });
    return res.output_text;
  }
}

class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(
    readonly model: string,
    apiKey: string,
    private settings: ProviderSettings = {},
  ) {
    this.client = new Anthropic({ apiKey, ...brainClientOptions(settings.timeoutMs) });
  }
  // Streaming allows a large cap, and thinking (always on for current Claude models) counts toward it.
  async complete({ system, prompt, maxTokens = 64000, images = [] }: CompleteOptions): Promise<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: "user",
          content: images.length
            ? [
                ...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.base64 } })),
                { type: "text" as const, text: prompt },
              ]
            : prompt,
        },
      ],
    });
    // The whole stream, including the SDK's one retry of a request that times out before headers.
    const { timeout, maxRetries } = brainClientOptions(this.settings.timeoutMs);
    const msg = await withDeadline(stream.finalMessage(), Math.min(timeout * (maxRetries + 1), 2_147_483_647), () => stream.abort());
    return anthropicReplyText(msg, maxTokens);
  }
}

/** The text of a finished Anthropic reply; throws on a refusal or a reply cut off at max_tokens. */
export function anthropicReplyText(msg: Pick<Anthropic.Message, "stop_reason" | "content">, maxTokens: number): string {
  if (msg.stop_reason === "refusal") throw new Error("The brain model declined this request.");
  if (msg.stop_reason === "max_tokens") {
    throw new Error(`The brain reply hit its ${maxTokens}-token limit (thinking counts toward it) before finishing.`);
  }
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

export function createProvider(
  provider: "openai" | "anthropic" = config.brainProvider,
  models: { openai: string; anthropic: string } = { openai: config.brainModelOpenai, anthropic: config.brainModelAnthropic },
  settings: ProviderSettings = {},
): LLMProvider | undefined {
  if (provider === "anthropic") {
    return config.anthropicKey ? new AnthropicProvider(models.anthropic, config.anthropicKey, settings) : undefined;
  }
  return config.openaiKey ? new OpenAIProvider(models.openai, config.openaiKey, settings) : undefined;
}

/** The AI players' model (AI_PLAYER_*): fast, short timeout, low reasoning effort on OpenAI. */
export function createAiPlayerProvider(): LLMProvider | undefined {
  return createProvider(
    config.aiPlayerProvider,
    { openai: config.aiPlayerModelOpenai, anthropic: config.aiPlayerModelAnthropic },
    { timeoutMs: config.aiPlayerTimeoutMs, reasoningEffort: "low" },
  );
}

/** consult_brain's planner: the brain's provider and models, with CONSULT_TIMEOUT_MS (the DM waits on it live). */
export function createConsultProvider(): LLMProvider | undefined {
  return createProvider(
    config.brainProvider,
    { openai: config.brainModelOpenai, anthropic: config.brainModelAnthropic },
    { timeoutMs: config.consultTimeoutMs },
  );
}

/** The phone character creation helper: the brain's provider and models, CREATION_TIMEOUT_MS and CREATION_REASONING_EFFORT. */
export function createCreationProvider(): LLMProvider | undefined {
  return createProvider(
    config.brainProvider,
    { openai: config.brainModelOpenai, anthropic: config.brainModelAnthropic },
    { timeoutMs: config.creationTimeoutMs, reasoningEffort: config.creationReasoningEffort },
  );
}

/** Pull the first JSON object/array out of a model reply (tolerates ```json fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = src[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON in model output");
}

/**
 * Ask for JSON matching a zod schema. Provider-agnostic: the schema goes in the prompt,
 * the reply is validated, and one repair round is attempted on failure.
 */
export async function completeJson<T>(
  llm: LLMProvider,
  opts: CompleteOptions & { schema: ZodType<T, ZodTypeDef, unknown>; schemaName: string },
): Promise<T> {
  const jsonSchema = JSON.stringify(zodToJsonSchema(opts.schema, { $refStrategy: "none" }));
  const system = `${opts.system}\n\nReply with a single JSON value for "${opts.schemaName}" matching this JSON Schema, and nothing else:\n${jsonSchema}`;
  let reply = await llm.complete({ ...opts, system });
  for (let attempt = 0; ; attempt++) {
    try {
      return opts.schema.parse(extractJson(reply));
    } catch (err) {
      if (attempt >= 1) throw new Error(`Brain returned invalid ${opts.schemaName}: ${(err as Error).message}`);
      reply = await llm.complete({
        ...opts,
        system,
        prompt: `${opts.prompt}\n\nYour previous reply was invalid (${(err as Error).message.slice(0, 500)}). Reply again with only valid JSON.`,
      });
    }
  }
}
