import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import("./config.js")).config;
}

describe("config: noise-turn gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to on with a 1200 ms timeout", async () => {
    const c = await load({ TURN_GATE: "", TURN_GATE_TIMEOUT_MS: "" });
    expect(c.turnGate).toBe(true);
    expect(c.turnGateTimeoutMs).toBe(1200);
  });

  it("TURN_GATE_TIMEOUT_MS=0 is honoured; junk falls back to 1200; negatives clamp to 0", async () => {
    expect((await load({ TURN_GATE_TIMEOUT_MS: "0" })).turnGateTimeoutMs).toBe(0);
    expect((await load({ TURN_GATE_TIMEOUT_MS: "800" })).turnGateTimeoutMs).toBe(800);
    expect((await load({ TURN_GATE_TIMEOUT_MS: "soon" })).turnGateTimeoutMs).toBe(1200);
    expect((await load({ TURN_GATE_TIMEOUT_MS: "-5" })).turnGateTimeoutMs).toBe(0);
  });

  it.each(["off", "OFF", "false", "0", "no", "disabled", "none", " off "])("TURN_GATE=%j turns the gate off", async (v) => {
    expect((await load({ TURN_GATE: v })).turnGate).toBe(false);
  });

  it.each(["on", "1", "true", "yes"])("TURN_GATE=%j keeps it on", async (v) => {
    expect((await load({ TURN_GATE: v })).turnGate).toBe(true);
  });
});

describe("config: brain timeout and reasoning effort", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("caps BRAIN_TIMEOUT_MS at setTimeout's maximum (larger values would fire at once)", async () => {
    expect(((await load({ BRAIN_TIMEOUT_MS: "9999999999" })) as Record<string, unknown>).brainTimeoutMs).toBe(2_147_483_647);
  });

  it("defaults to a 15 minute timeout and no reasoning effort", async () => {
    const c = (await load({ BRAIN_TIMEOUT_MS: "", BRAIN_REASONING_EFFORT: "" })) as Record<string, unknown>;
    expect(c.brainTimeoutMs).toBe(900_000);
    expect(c.brainReasoningEffort).toBeUndefined();
  });

  it("reads BRAIN_TIMEOUT_MS; junk falls back to the default", async () => {
    expect(((await load({ BRAIN_TIMEOUT_MS: "90000" })) as Record<string, unknown>).brainTimeoutMs).toBe(90_000);
    expect(((await load({ BRAIN_TIMEOUT_MS: "soon" })) as Record<string, unknown>).brainTimeoutMs).toBe(900_000);
  });

  it("reads BRAIN_REASONING_EFFORT (trimmed)", async () => {
    expect(((await load({ BRAIN_REASONING_EFFORT: " low " })) as Record<string, unknown>).brainReasoningEffort).toBe("low");
  });
});

describe("config: map prepaint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on by default", async () => {
    expect(((await load({ PREPAINT_MAPS: "" })) as Record<string, unknown>).prepaintMaps).toBe(true);
  });

  it.each(["0", "false", "off", "OFF"])("PREPAINT_MAPS=%j turns it off", async (v) => {
    expect(((await load({ PREPAINT_MAPS: v })) as Record<string, unknown>).prepaintMaps).toBe(false);
  });

  it.each(["1", "true", "on"])("PREPAINT_MAPS=%j keeps it on", async (v) => {
    expect(((await load({ PREPAINT_MAPS: v })) as Record<string, unknown>).prepaintMaps).toBe(true);
  });
});

describe("config: brain timeout edge cases (adversarial review)", () => {
  afterEach(() => vi.unstubAllEnvs());

  // The SDKs do setTimeout(abort, timeout): 0 aborts every brain call at once. "0" must mean
  // "no limit" or fall back to the default, never a zero-millisecond timeout.
  it("BRAIN_TIMEOUT_MS=0 never yields a 0 ms timeout", async () => {
    expect(((await load({ BRAIN_TIMEOUT_MS: "0" })) as Record<string, unknown>).brainTimeoutMs).toBeGreaterThan(0);
  });
});
