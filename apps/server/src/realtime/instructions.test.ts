import { describe, expect, it } from "vitest";
import { Campaign, emptyGameState } from "@dm/shared";
import { buildInstructions } from "./instructions.js";

function campaign() {
  return Campaign.parse({
    id: "cmp_1",
    name: "Bells",
    premise: "",
    createdAt: 0,
    updatedAt: 0,
    outline: {
      title: "The Silent Bell",
      hook: "The bell stopped ringing.",
      npcs: [
        { name: "Sister Maren", description: "Caretaker.", motive: "Keep the crypt sealed.", voice: "breathy whisper, long pauses" },
        { name: "Grub", description: "Goblin boss.", motive: "Loot." },
      ],
    },
  });
}

describe("buildInstructions", () => {
  it("includes each NPC's voice direction and asks the DM to perform it", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    expect(text).toContain("- Sister Maren: Caretaker. Wants: Keep the crypt sealed. Voice: breathy whisper, long pauses");
    expect(text).toMatch(/- Grub: Goblin boss\. Wants: Loot\.$/m);
    expect(text).toContain('"Voice:" direction');
  });

  it("old outlines without NPC voices still parse (default empty)", () => {
    const c = campaign();
    expect(c.outline!.npcs[1].voice).toBe("");
  });

  it("mentions speak_as_npc only when NPC TTS is enabled", () => {
    expect(buildInstructions(campaign(), emptyGameState("cmp_1"))).not.toContain("speak_as_npc");
    expect(buildInstructions(campaign(), emptyGameState("cmp_1"), { npcTts: true })).toContain("speak_as_npc");
  });
});
