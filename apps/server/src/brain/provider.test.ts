import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { completeJson, extractJson, type LLMProvider } from "./provider.js";

describe("extractJson", () => {
  it("handles fences, prose and nested braces in strings", () => {
    expect(extractJson('Sure!\n```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: "}" } });
    expect(extractJson('Here: [1, 2, {"x": "\\"q\\""}] done')).toEqual([1, 2, { x: '"q"' }]);
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("completeJson", () => {
  const schema = z.object({ name: z.string(), hp: z.number() });
  it("retries once with the validation error", async () => {
    const complete = vi.fn().mockResolvedValueOnce('{"name": "Bob"}').mockResolvedValueOnce('{"name": "Bob", "hp": 7}');
    const llm: LLMProvider = { name: "fake", model: "m", complete };
    await expect(completeJson(llm, { system: "s", prompt: "p", schema, schemaName: "X" })).resolves.toEqual({ name: "Bob", hp: 7 });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].system).toContain("JSON Schema");
    expect(complete.mock.calls[1][0].prompt).toContain("previous reply was invalid");
  });
  it("gives up after the repair attempt", async () => {
    const llm: LLMProvider = { name: "fake", model: "m", complete: vi.fn().mockResolvedValue("nope") };
    await expect(completeJson(llm, { system: "s", prompt: "p", schema, schemaName: "X" })).rejects.toThrow(/invalid X/);
  });
});

describe("OpenAI brain request options", () => {
  type Cfg = { brainTimeoutMs?: number; brainReasoningEffort?: string };
  async function helpers() {
    const mod = (await import("./provider.js")) as unknown as {
      brainClientOptions: () => { timeout: number; maxRetries: number };
      reasoningParam: () => { reasoning?: { effort: string } };
    };
    const { config } = await import("../config.js");
    return { ...mod, cfg: config as unknown as Cfg };
  }

  it("the client uses the configured timeout and a single retry", async () => {
    const { brainClientOptions, cfg } = await helpers();
    const saved = cfg.brainTimeoutMs;
    cfg.brainTimeoutMs = 123_000;
    try {
      expect(brainClientOptions()).toEqual({ timeout: 123_000, maxRetries: 1 });
    } finally {
      cfg.brainTimeoutMs = saved;
    }
  });

  it("sends a reasoning effort only when one is configured", async () => {
    const { reasoningParam, cfg } = await helpers();
    const saved = cfg.brainReasoningEffort;
    try {
      cfg.brainReasoningEffort = undefined;
      expect(reasoningParam()).toEqual({});
      cfg.brainReasoningEffort = "low";
      expect(reasoningParam()).toEqual({ reasoning: { effort: "low" } });
    } finally {
      cfg.brainReasoningEffort = saved;
    }
  });
});
