import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { completeJson, extractJson, withDeadline, type LLMProvider } from "./provider.js";

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

describe("withDeadline (a deadline over the whole brain request, incl. a stalled stream)", () => {
  afterEach(() => void vi.useRealTimers());

  it("resolves with the value when the work settles first, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let resolve!: (v: string) => void;
    const work = new Promise<string>((r) => (resolve = r));
    const p = withDeadline(work, 1000, onTimeout);
    await vi.advanceTimersByTimeAsync(500);
    resolve("done");
    await expect(p).resolves.toBe("done");
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("rejects with a timeout and calls onTimeout once when the deadline passes first", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const p = withDeadline(new Promise<string>(() => undefined), 1000, onTimeout);
    const settled = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("rejects with the work's own error when it fails first, and clears the timer", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let reject!: (e: Error) => void;
    const work = new Promise<string>((_, r) => (reject = r));
    const p = withDeadline(work, 1000, onTimeout);
    reject(new Error("overloaded"));
    await expect(p).rejects.toThrow("overloaded");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("withDeadline when onTimeout throws", () => {
  afterEach(() => void vi.useRealTimers());

  it("still rejects with the timeout when onTimeout (stream.abort) throws", async () => {
    vi.useFakeTimers();
    const p = withDeadline(new Promise<string>(() => undefined), 1000, () => {
      throw new Error("abort failed");
    });
    let outcome: "pending" | "resolved" | "rejected" = "pending";
    p.then(
      () => (outcome = "resolved"),
      () => (outcome = "rejected"),
    );
    try {
      await vi.advanceTimersByTimeAsync(1000);
    } catch {
      /* the throw escapes the timer callback */
    }
    await Promise.resolve();
    expect(outcome).toBe("rejected");
  });
});

describe("createConsultProvider (consult_brain's planner)", () => {
  it("uses the brain's provider and model with CONSULT_TIMEOUT_MS and one retry", async () => {
    const { createConsultProvider } = await import("./provider.js");
    const { config } = await import("../config.js");
    const saved = { key: config.openaiKey, provider: config.brainProvider, timeout: config.consultTimeoutMs };
    try {
      config.openaiKey = "sk-test";
      config.brainProvider = "openai";
      config.consultTimeoutMs = 12_345;
      const p = createConsultProvider();
      expect(p?.name).toBe("openai");
      expect(p?.model).toBe(config.brainModelOpenai);
      const client = (p as unknown as { client: { timeout: number; maxRetries: number } }).client;
      expect(client.timeout).toBe(12_345);
      expect(client.maxRetries).toBe(1);
      config.openaiKey = "";
      expect(createConsultProvider()).toBeUndefined();
    } finally {
      config.openaiKey = saved.key;
      config.brainProvider = saved.provider;
      config.consultTimeoutMs = saved.timeout;
    }
  });
});
