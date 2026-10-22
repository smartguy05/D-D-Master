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

describe("config: NPC voices (NPC_TTS, Phase 4)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on by default (unset or empty)", async () => {
    expect((await load({ NPC_TTS: "" })).npcTts).toBe(true);
    vi.resetModules();
    vi.stubEnv("NPC_TTS", undefined as unknown as string);
    expect((await import("./config.js")).config.npcTts).toBe(true);
  });

  it.each(["0", "false", "no", "off", "OFF", " off "])("NPC_TTS=%j turns it off", async (v) => {
    expect((await load({ NPC_TTS: v })).npcTts).toBe(false);
  });

  it.each(["1", "true", "yes", "on"])("NPC_TTS=%j keeps it on", async (v) => {
    expect((await load({ NPC_TTS: v })).npcTts).toBe(true);
  });

  it("NpcVoice is still unavailable without OPENAI_API_KEY", async () => {
    await load({ NPC_TTS: "1", OPENAI_API_KEY: "" });
    const { createNpcVoice } = await import("./realtime/npc-voice.js");
    expect(createNpcVoice().available).toBe(false);
  });

  it(".env.example turns NPC_TTS on and says how to turn it off", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./config.js");
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^NPC_TTS=1\s*$/m);
    expect(example).toMatch(/NPC_TTS=0/);
  });
});

describe("config: consult, image and HTTPS settings", () => {
  afterEach(() => vi.unstubAllEnvs());
  const get = async (env: Record<string, string>, key: string) => ((await load(env)) as Record<string, unknown>)[key];

  it("CONSULT_TIMEOUT_MS defaults to 30 s, reads a value, junk falls back, 0 is no limit, huge is capped", async () => {
    expect(await get({ CONSULT_TIMEOUT_MS: "" }, "consultTimeoutMs")).toBe(30_000);
    expect(await get({ CONSULT_TIMEOUT_MS: "45000" }, "consultTimeoutMs")).toBe(45_000);
    expect(await get({ CONSULT_TIMEOUT_MS: "soon" }, "consultTimeoutMs")).toBe(30_000);
    expect(await get({ CONSULT_TIMEOUT_MS: "0" }, "consultTimeoutMs")).toBe(2_147_483_647);
    expect(await get({ CONSULT_TIMEOUT_MS: "9999999999" }, "consultTimeoutMs")).toBe(2_147_483_647);
  });

  it("IMAGE_TIMEOUT_MS defaults to 5 min, reads a value, junk falls back, 0 is no limit, huge is capped", async () => {
    expect(await get({ IMAGE_TIMEOUT_MS: "" }, "imageTimeoutMs")).toBe(300_000);
    expect(await get({ IMAGE_TIMEOUT_MS: "60000" }, "imageTimeoutMs")).toBe(60_000);
    expect(await get({ IMAGE_TIMEOUT_MS: "later" }, "imageTimeoutMs")).toBe(300_000);
    expect(await get({ IMAGE_TIMEOUT_MS: "0" }, "imageTimeoutMs")).toBe(2_147_483_647);
    expect(await get({ IMAGE_TIMEOUT_MS: "9999999999" }, "imageTimeoutMs")).toBe(2_147_483_647);
  });

  it("HTTPS_PORT defaults to 8443, 0 turns it off, junk or out of range falls back", async () => {
    expect(await get({ HTTPS_PORT: "" }, "httpsPort")).toBe(8443);
    expect(await get({ HTTPS_PORT: "9443" }, "httpsPort")).toBe(9443);
    expect(await get({ HTTPS_PORT: "0" }, "httpsPort")).toBe(0);
    expect(await get({ HTTPS_PORT: "abc" }, "httpsPort")).toBe(8443);
    expect(await get({ HTTPS_PORT: "70000" }, "httpsPort")).toBe(8443);
    expect(await get({ HTTPS_PORT: "-1" }, "httpsPort")).toBe(8443);
  });

  it("HTTPS_CERT and HTTPS_KEY are trimmed paths, empty by default", async () => {
    const c = (await load({ HTTPS_CERT: " /c.pem ", HTTPS_KEY: "" })) as Record<string, unknown>;
    expect(c.httpsCert).toBe("/c.pem");
    expect(c.httpsKey).toBe("");
  });
});

describe("config: voice call handover", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to renewing after 50 min with a 57 min deadline", async () => {
    const c = await load({ VOICE_HANDOVER_AFTER_MS: "", VOICE_HANDOVER_DEADLINE_MS: "" });
    expect(c.voiceHandoverAfterMs).toBe(3_000_000);
    expect(c.voiceHandoverDeadlineMs).toBe(3_420_000);
  });

  it("reads the variables; junk falls back; 0 and huge values cap at setTimeout's maximum", async () => {
    expect((await load({ VOICE_HANDOVER_AFTER_MS: "120000" })).voiceHandoverAfterMs).toBe(120_000);
    expect((await load({ VOICE_HANDOVER_DEADLINE_MS: "soon" })).voiceHandoverDeadlineMs).toBe(3_420_000);
    expect((await load({ VOICE_HANDOVER_AFTER_MS: "0" })).voiceHandoverAfterMs).toBe(2_147_483_647);
    expect((await load({ VOICE_HANDOVER_DEADLINE_MS: "9999999999" })).voiceHandoverDeadlineMs).toBe(2_147_483_647);
  });
});

describe("vadEagerness", () => {
  it("defaults to low and accepts medium/high/auto in any case", async () => {
    const { vadEagerness } = await import("./config.js");
    expect(vadEagerness(undefined)).toBe("low");
    expect(vadEagerness("")).toBe("low");
    expect(vadEagerness("junk")).toBe("low");
    expect(vadEagerness(" High ")).toBe("high");
    expect(vadEagerness("auto")).toBe("auto");
    expect(vadEagerness("medium")).toBe("medium");
  });
});
