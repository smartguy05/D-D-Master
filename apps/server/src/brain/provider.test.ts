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
