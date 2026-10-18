import { describe, expect, it } from "vitest";
import { Campaign, Location, emptyGameState } from "@dm/shared";
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

  it("lists the current map's features with grid coordinates", () => {
    const c = campaign();
    c.outline!.locations.push(
      Location.parse({ id: "loc_nave", name: "Nave", gridW: 22, gridH: 14, features: [{ name: "altar", kind: "focal", lit: true, x: 11, y: 1, w: 5, h: 4 }] }),
    );
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_nave";
    const text = buildInstructions(c, s);
    expect(text).toContain("Map features (grid cells");
    expect(text).toContain("- altar (focal, lit): x 11-15, y 1-4");
    s.locationId = undefined;
    expect(buildInstructions(c, s)).not.toContain("Map features");
  });

  it("uses the host's feature edits for the current map", () => {
    const c = campaign();
    c.outline!.locations.push(
      Location.parse({ id: "loc_nave", name: "Nave", mapUrl: "/m/1.png", features: [{ name: "altar", kind: "focal", x: 11, y: 1 }] }),
    );
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_nave";
    s.featureEdits = { loc_nave: { mapUrl: "/m/1.png", features: [{ name: "pews", kind: "feature", lit: false, blocks: true, x: 4, y: 3, w: 1, h: 1 }] } };
    const text = buildInstructions(c, s);
    expect(text).toContain("- pews (blocks): x 4, y 3");
    expect(text).not.toContain("altar");
  });

  it("tells the DM about set_monster_hidden for ambushes but not the host-only board tools", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    expect(text).toContain("set_monster_hidden");
    expect(text).not.toContain("edit_fog");
    expect(text).not.toContain("edit_map_feature");
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
