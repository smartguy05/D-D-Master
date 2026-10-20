import { describe, expect, it, vi } from "vitest";
import { generatePregens } from "./content.js";
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
