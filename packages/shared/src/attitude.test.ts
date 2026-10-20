import { describe, expect, it } from "vitest";
import * as shared from "./index.js";
import { GameState, Moment, MomentKind, Monster, emptyGameState } from "./schemas.js";
import { ToolArgs, TOOL_DESCRIPTIONS } from "./tools.js";

/**
 * NPC attitude scale (Phase 4): 2024 SRD attitudes (Hostile / Indifferent / Friendly) on a gradual
 * -5..+5 score. Old saves without the fields derive both from the disposition flags.
 */

type AttitudeInput = Partial<Pick<Monster, "ally" | "neutral">> & { attitude?: string; attitudeScore?: number };
type AttitudeFns = {
  attitudeOf: (m: AttitudeInput) => { attitude: string; score: number };
  attitudeForScore: (score: number) => string;
  dispositionForAttitude: (a: string) => string;
  defaultNpcVoice: (name: string, appearance?: string, creatureType?: string) => string;
};
const fns = shared as unknown as AttitudeFns;

const oldMonster = { id: "mon_1", name: "Goblin", maxHp: 7, hp: 7 };

describe("Monster schema: attitude, attitudeScore, voice", () => {
  it("an old saved Monster without the new fields parses; they stay undefined", () => {
    const m = Monster.parse(oldMonster) as Record<string, unknown>;
    expect(m.attitude).toBeUndefined();
    expect(m.attitudeScore).toBeUndefined();
    expect(m.voice).toBeUndefined();
  });

  it("an old saved GameState with such monsters parses", () => {
    const s = { ...emptyGameState("c1"), monsters: [oldMonster, { ...oldMonster, id: "mon_2", npc: true, ally: true }] };
    const parsed = GameState.parse(JSON.parse(JSON.stringify(s)));
    expect(parsed.monsters).toHaveLength(2);
  });

  it("keeps attitude, attitudeScore and voice when given", () => {
    const m = Monster.parse({ ...oldMonster, attitude: "friendly", attitudeScore: 4, voice: "gravelly, slow" }) as Record<string, unknown>;
    expect(m).toMatchObject({ attitude: "friendly", attitudeScore: 4, voice: "gravelly, slow" });
  });

  it("accepts each attitude and rejects others", () => {
    for (const attitude of ["hostile", "indifferent", "friendly"]) expect(Monster.safeParse({ ...oldMonster, attitude }).success).toBe(true);
    expect(Monster.safeParse({ ...oldMonster, attitude: "angry" }).success).toBe(false);
  });

  it("attitudeScore is an integer in -5..5", () => {
    for (const attitudeScore of [-5, 0, 5]) expect(Monster.safeParse({ ...oldMonster, attitudeScore }).success).toBe(true);
    for (const attitudeScore of [-6, 6, 1.5]) expect(Monster.safeParse({ ...oldMonster, attitudeScore }).success).toBe(false);
  });
});

describe("attitudeForScore", () => {
  it("<= -3 hostile, -2..+2 indifferent, >= +3 friendly (boundaries)", () => {
    expect(fns.attitudeForScore(-5)).toBe("hostile");
    expect(fns.attitudeForScore(-3)).toBe("hostile");
    expect(fns.attitudeForScore(-2)).toBe("indifferent");
    expect(fns.attitudeForScore(0)).toBe("indifferent");
    expect(fns.attitudeForScore(2)).toBe("indifferent");
    expect(fns.attitudeForScore(3)).toBe("friendly");
    expect(fns.attitudeForScore(5)).toBe("friendly");
  });
});

describe("attitudeOf", () => {
  it("derives from disposition flags on an old save: neutral, ally, foe", () => {
    expect(fns.attitudeOf({ neutral: true })).toEqual({ attitude: "indifferent", score: 0 });
    expect(fns.attitudeOf({ ally: true })).toEqual({ attitude: "friendly", score: 3 });
    expect(fns.attitudeOf({ ally: false, neutral: false })).toEqual({ attitude: "hostile", score: -3 });
    expect(fns.attitudeOf({})).toEqual({ attitude: "hostile", score: -3 });
  });

  it("neutral wins when both flags are set (as dispositionOf)", () => {
    expect(fns.attitudeOf({ ally: true, neutral: true })).toEqual({ attitude: "indifferent", score: 0 });
  });

  it("returns stored values when both are present", () => {
    expect(fns.attitudeOf({ ally: false, attitude: "indifferent", attitudeScore: -2 })).toEqual({ attitude: "indifferent", score: -2 });
    expect(fns.attitudeOf({ ally: true, attitude: "friendly", attitudeScore: 5 })).toEqual({ attitude: "friendly", score: 5 });
  });

  it("only attitudeScore stored: attitude by thresholds", () => {
    expect(fns.attitudeOf({ ally: true, attitudeScore: -3 })).toEqual({ attitude: "hostile", score: -3 });
    expect(fns.attitudeOf({ attitudeScore: -2 })).toEqual({ attitude: "indifferent", score: -2 });
    expect(fns.attitudeOf({ attitudeScore: 2 })).toEqual({ attitude: "indifferent", score: 2 });
    expect(fns.attitudeOf({ attitudeScore: 3 })).toEqual({ attitude: "friendly", score: 3 });
  });

  it("only attitude stored: score -3 / 0 / +3", () => {
    expect(fns.attitudeOf({ attitude: "hostile" })).toEqual({ attitude: "hostile", score: -3 });
    expect(fns.attitudeOf({ ally: true, attitude: "indifferent" })).toEqual({ attitude: "indifferent", score: 0 });
    expect(fns.attitudeOf({ attitude: "friendly" })).toEqual({ attitude: "friendly", score: 3 });
  });
});

describe("dispositionForAttitude", () => {
  it("hostile -> foe, indifferent -> neutral, friendly -> ally", () => {
    expect(fns.dispositionForAttitude("hostile")).toBe("foe");
    expect(fns.dispositionForAttitude("indifferent")).toBe("neutral");
    expect(fns.dispositionForAttitude("friendly")).toBe("ally");
  });
});

describe("defaultNpcVoice", () => {
  it("is a short, non-empty, deterministic direction", () => {
    const a = fns.defaultNpcVoice("Pell Netter", "a wiry fisherman in oilskins", "humanoid");
    expect(typeof a).toBe("string");
    expect(a.trim().length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(200);
    expect(fns.defaultNpcVoice("Pell Netter", "a wiry fisherman in oilskins", "humanoid")).toBe(a);
    expect(fns.defaultNpcVoice("Old Wick").trim().length).toBeGreaterThan(0);
  });

  it("different names generally give different directions", () => {
    const names = ["Pell Netter", "Captain Mara Venn", "Sister Maren", "Grub", "Old Wick", "Tikk", "Lady Esme", "Brother Aldo", "Hask the Smith", "Nim", "Orla", "Varric", "Zed", "Quill", "Bertrand", "Yusra"];
    const voices = new Set(names.map((n) => fns.defaultNpcVoice(n)));
    expect(voices.size).toBeGreaterThanOrEqual(6);
  });

  it("picks pitch, pace, timbre and manner independently: all 64 pitch|pace pairs and most of the 6400 combos occur (review fix)", () => {
    const names = Array.from({ length: 3000 }, (_, i) => `Npc ${i}`);
    const voices = names.map((n) => fns.defaultNpcVoice(n));
    const pairs = new Set(voices.map((v) => v.split(";")[0]!.split(", ")[1]! + "|" + v.split(";")[1]!.trim()));
    expect(pairs.size).toBe(64);
    // 3000 draws from 6400 equally likely combos give ~2400 distinct; the old pick gave ~200.
    expect(new Set(voices).size).toBeGreaterThan(2000);
    // Twenty typical names: all different.
    const typical = ["Pell Netter", "Captain Mara Venn", "Sister Maren", "Grub", "Old Wick", "Tikk", "Lady Esme", "Brother Aldo", "Hask the Smith", "Nim", "Orla", "Varric", "Zed", "Quill", "Bertrand", "Yusra", "Dorn", "Old Tam", "Fennick", "Marta"];
    expect(new Set(typical.map((n) => fns.defaultNpcVoice(n))).size).toBeGreaterThanOrEqual(19);
  });
});

describe("Moment: attitude", () => {
  it("MomentKind has 'attitude' and outcome takes hostile/indifferent/friendly", () => {
    expect(MomentKind.options).toContain("attitude");
    for (const outcome of ["hostile", "indifferent", "friendly"]) {
      expect(Moment.safeParse({ id: "mo_1", kind: "attitude", targetId: "mon_1", outcome, ts: 1 }).success).toBe(true);
    }
  });

  it("moments stay transient: GameState has no moments field", () => {
    expect(Object.keys(GameState.shape)).not.toContain("moments");
  });
});

describe("adjust_attitude args", () => {
  const schema = () => (ToolArgs as Record<string, { safeParse(v: unknown): { success: boolean } }>).adjust_attitude;

  it("exists with a description", () => {
    expect(schema()).toBeDefined();
    expect((TOOL_DESCRIPTIONS as Record<string, string>).adjust_attitude).toEqual(expect.any(String));
  });

  it("delta is a non-zero integer in -5..5; reason is required", () => {
    const ok = (delta: unknown, reason: unknown = "gift of bread") => schema().safeParse({ npc_id: "mon_1", delta, reason }).success;
    expect(ok(1)).toBe(true);
    expect(ok(-5)).toBe(true);
    expect(ok(5)).toBe(true);
    for (const bad of [0, 6, -6, 1.5]) expect(ok(bad)).toBe(false);
    expect(ok(1, "")).toBe(false);
    expect(schema().safeParse({ delta: 1, reason: "x" }).success).toBe(false);
  });
});

describe("add_npc voice and speak_as_npc wording", () => {
  it("add_npc takes an optional voice up to 200 characters", () => {
    expect(ToolArgs.add_npc.safeParse({ name: "Pell", voice: "gravelly, slow" }).success).toBe(true);
    expect((ToolArgs.add_npc.parse({ name: "Pell", voice: "gravelly" }) as Record<string, unknown>).voice).toBe("gravelly");
    expect(ToolArgs.add_npc.safeParse({ name: "Pell", voice: "x".repeat(201) }).success).toBe(false);
  });

  it("speak_as_npc's description no longer says to use it sparingly", () => {
    expect(TOOL_DESCRIPTIONS.speak_as_npc).not.toMatch(/sparingly/i);
  });
});
