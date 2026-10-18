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
