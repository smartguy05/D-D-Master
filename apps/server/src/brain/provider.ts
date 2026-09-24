import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodType, ZodTypeDef } from "zod";
import { config } from "../config.js";

export interface CompleteOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
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

class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;
  constructor(readonly model: string, apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }
  async complete({ system, prompt, maxTokens = 16000 }: CompleteOptions): Promise<string> {
    const res = await this.client.responses.create({
      model: this.model,
      instructions: system,
      input: prompt,
      max_output_tokens: maxTokens,
    });
    return res.output_text;
  }
}

class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(readonly model: string, apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }
  async complete({ system, prompt, maxTokens = 16000 }: CompleteOptions): Promise<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("The brain model declined this request.");
    return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
}

export function createProvider(): LLMProvider | undefined {
  if (config.brainProvider === "anthropic") {
    return config.anthropicKey ? new AnthropicProvider(config.brainModelAnthropic, config.anthropicKey) : undefined;
  }
  return config.openaiKey ? new OpenAIProvider(config.brainModelOpenai, config.openaiKey) : undefined;
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
