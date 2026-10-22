import { describe, expect, it, vi } from "vitest";
import { Campaign } from "@dm/shared";
import { draftCustomSpecies, generatePregens } from "./content.js";
import type { LLMProvider } from "./provider.js";

const SRD = ["Bless", "Cure Wounds", "Guiding Bolt", "Sacred Flame", "Guidance", "Light"];
const isSpell = (name: string) => SRD.find((s) => s.toLowerCase() === name.trim().toLowerCase());

const prosyCleric = {
  name: "Sister Morra Tideward",
  className: "Cleric",
  maxHp: 10,
  spells: ["Spellcasting: Wisdom; spell save DC 13; +5 to hit", "Prepared level-1 cleric spells: Bless, Cure Wounds, Guiding Bolt", "Cantrips: Sacred Flame, Guidance and Light"],
};

describe("generatePregens spell names", () => {
  it("normalises prose spell lists into SRD spell names", async () => {
    const llm: LLMProvider = { name: "fake", model: "m", complete: vi.fn().mockResolvedValue(JSON.stringify({ characters: [prosyCleric] })) };
    const [c] = await (generatePregens as unknown as (...a: unknown[]) => Promise<Array<{ spells: string[] }>>)(llm, undefined, 1, 1, "a healer cleric", isSpell);
    expect(c!.spells).toEqual(["Bless", "Cure Wounds", "Guiding Bolt", "Sacred Flame", "Guidance", "Light"]);
  });

  it("tells the model to list spell names only", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ characters: [{ ...prosyCleric, spells: ["Bless"] }] }));
    const llm: LLMProvider = { name: "fake", model: "m", complete };
    await (generatePregens as unknown as (...a: unknown[]) => Promise<unknown>)(llm, undefined, 1, 1, "", isSpell);
    const { system, prompt } = complete.mock.calls[0]![0] as { system: string; prompt: string };
    expect(`${system}\n${prompt}`).toMatch(/spell names only/i);
  });
});

describe("CharacterDraft light (bug: pregens-blind-in-fog)", () => {
  it("has no lightRadius, so structured output can't fill it with 0", async () => {
    const { CharacterDraft } = await import("./content.js");
    expect(Object.keys(CharacterDraft.shape)).not.toContain("lightRadius");
    expect(CharacterDraft.parse({ name: "Bram", maxHp: 12, lightRadius: 0 })).not.toHaveProperty("lightRadius");
  });
});

describe("generatePregens: campaign constraints", () => {
  const campaign = Campaign.parse({ id: "c", name: "Rat City", createdAt: 1, updatedAt: 1, constraints: { allowedSpecies: ["Sewer Rat"], customSpecies: [{ name: "Sewer Rat" }] } });
  const rat = { name: "Pip", species: "Sewer Rat", className: "Rogue", maxHp: 9 };
  const elf = { name: "Lia", species: "Elf", className: "Wizard", maxHp: 7 };
  const run = (llm: LLMProvider) => (generatePregens as unknown as (...a: unknown[]) => Promise<Array<{ name: string }>>)(llm, campaign, 2, 1, "");

  it("states the rules and keeps only allowed characters after one retry", async () => {
    const complete = vi.fn().mockResolvedValueOnce(JSON.stringify({ characters: [rat, elf] })).mockResolvedValueOnce(JSON.stringify({ characters: [rat, elf] }));
    const out = await run({ name: "fake", model: "m", complete });
    expect(complete).toHaveBeenCalledTimes(2);
    expect((complete.mock.calls[0]![0] as { system: string }).system).toContain("Allowed species (only these): Sewer Rat.");
    expect((complete.mock.calls[1]![0] as { prompt: string }).prompt).toContain("Lia: Elf isn't allowed");
    expect(out.map((c) => c.name)).toEqual(["Pip"]);
  });

  it("does not retry when every character is allowed", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ characters: [rat] }));
    expect((await run({ name: "fake", model: "m", complete })).map((c) => c.name)).toEqual(["Pip"]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("throws when none are left", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ characters: [elf] }));
    await expect(run({ name: "fake", model: "m", complete })).rejects.toThrow(/species\/class rules/);
  });
});

describe("draftCustomSpecies", () => {
  it("returns SRD-shaped species with defaults filled in", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ species: [{ name: "Sewer Rat", description: "A wiry grey rat.", traits: [{ name: "Squeeze", text: "Fit through gaps." }] }] }));
    const [s] = await draftCustomSpecies({ name: "fake", model: "m", complete }, undefined, "rats for a sewer city");
    expect(s).toMatchObject({ name: "Sewer Rat", speed: 30, creatureType: "Humanoid", cantrips: [], choices: [] });
    expect((complete.mock.calls[0]![0] as { prompt: string }).prompt).toContain("rats for a sewer city");
  });
});
