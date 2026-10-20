import { describe, expect, it } from "vitest";
import { Campaign, Character, Location, emptyGameState } from "@dm/shared";
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

describe("attack animations in the instructions", () => {
  it("tells the DM, in one short line, to pass target_id/attack_name on attack rolls and source_id on damage", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    const lines = text.split("\n").filter((l) => /attack_name/.test(l));
    expect(lines).toHaveLength(1);
    for (const t of ["target_id", "source_id", "attack_name"]) expect(lines[0]).toContain(t);
    expect(lines[0].length).toBeLessThan(420);
  });
});

describe("turn economy in the instructions", () => {
  it("has one bullet on enforced turn limits, take_action, action_type and override", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    const bullets = text.split("\n").filter((l) => /take_action/.test(l));
    expect(bullets).toHaveLength(1);
    for (const t of ["Speed", "bonus action", "reaction", "action_type", "override"]) expect(bullets[0]).toContain(t);
    expect(bullets[0].length).toBeLessThan(600);
  });
});

describe("rules engine in the instructions", () => {
  it("adds one compact MECHANICS bullet naming the rules tools", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    const bullets = text.split("\n").filter((l) => /cast_spell/.test(l));
    expect(bullets).toHaveLength(1);
    for (const t of ["cast_spell", "short_rest", "long_rest", "level_up", "death_save", "revive"]) expect(bullets[0]).toContain(t);
    expect(bullets[0]).toMatch(/automatic/i);
    expect(bullets[0].length).toBeLessThan(420);
  });

  it("shows slots, pact slots, hit dice, concentration, resources and death saves compactly in PARTY", () => {
    const s = emptyGameState("cmp_1");
    s.characters.push(
      Character.parse({
        id: "pc_w",
        playerName: "Alex",
        name: "Lyra",
        className: "Wizard",
        level: 5,
        maxHp: 27,
        hp: 27,
        spellSlots: [
          { level: 1, max: 4, used: 2 },
          { level: 2, max: 3, used: 3 },
          { level: 3, max: 2, used: 0 },
        ],
        hitDice: { die: 6, max: 5, used: 1 },
        concentration: { spell: "Hold Person", since: 1 },
        resources: [{ name: "Arcane Recovery", max: 1, used: 0, resetOn: "long" }],
      }),
      Character.parse({ id: "pc_k", playerName: "Jo", name: "Kel", className: "Warlock", level: 5, maxHp: 30, hp: 0, pactSlots: { level: 3, max: 2, used: 1 }, hitDice: { die: 8, max: 5 }, deathSaves: { successes: 1, failures: 2 } }),
    );
    const lines = buildInstructions(campaign(), s).split("\n");
    const lyra = lines.find((l) => l.startsWith("- Lyra"))!;
    expect(lyra).toContain("; slots 1:2/4 2:0/3 3:2/2; HD 4/5 d6; conc Hold Person; Arcane Recovery 1/1");
    const kel = lines.find((l) => l.startsWith("- Kel"))!;
    expect(kel).toContain("pact L3 1/2; HD 5/5 d8; DOWN saves S1 F2");
    // The rules part stays short (no JSON, no feature notes).
    expect(lyra.length - lyra.indexOf("; slots")).toBeLessThan(90);
    expect(lyra).not.toContain("note");
  });
});

describe("doors, line of sight and cover in the DM instructions (T3)", () => {
  const doorLoc = () =>
    Location.parse({
      id: "loc_crypt",
      name: "Crypt",
      gridW: 12,
      gridH: 10,
      walls: [
        { id: "w1", x1: 4, y1: 0, x2: 4, y2: 2 },
        { id: "d1", x1: 4, y1: 2, x2: 4, y2: 3, kind: "door" },
        { id: "d2", x1: 6, y1: 5, x2: 7, y2: 5, kind: "door", open: true },
      ],
    });

  it("lists the current location's doors with id, position and open/closed, and the rules", () => {
    const c = campaign();
    c.outline!.locations.push(doorLoc());
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_crypt";
    const text = buildInstructions(c, s);
    const doorLine = text.split("\n").find((l) => l.includes("d1"));
    expect(doorLine).toBeDefined();
    expect(doorLine).toMatch(/closed/i);
    expect(doorLine).toMatch(/4/);
    const d2 = text.split("\n").find((l) => /\bd2\b/.test(l)); // not "1d20" in the persona
    expect(d2).toMatch(/open/i);
    expect(text).toContain("set_door");
    expect(text).toMatch(/line of sight/i);
    expect(text).toMatch(/cover/i);
    expect(text).toMatch(/\+2/);
    expect(text).toMatch(/\+5/);
  });

  it("uses the host's wall edits (a door opened with set_door shows as open)", () => {
    const c = campaign();
    c.outline!.locations.push(doorLoc());
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_crypt";
    (s as unknown as { wallEdits: unknown }).wallEdits = { loc_crypt: { walls: [{ id: "d1", x1: 4, y1: 2, x2: 4, y2: 3, kind: "door", open: true }] } };
    const doorLine = buildInstructions(c, s).split("\n").find((l) => l.includes("d1"));
    expect(doorLine).toMatch(/open/i);
    expect(doorLine).not.toMatch(/closed/i);
  });

  it("no door list without doors at the current location", () => {
    const c = campaign();
    c.outline!.locations.push(Location.parse({ id: "loc_field", name: "Field", gridW: 12, gridH: 10 }));
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_field";
    const text = buildInstructions(c, s);
    expect(text).not.toMatch(/^Doors/m);
  });
});

describe("tool catalog doc (T3)", () => {
  it("documents set_door and edit_walls", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const doc = readFileSync(fileURLToPath(new URL("../../../../docs/reference/tool-catalog.md", import.meta.url)), "utf8");
    expect(doc).toContain("set_door");
    expect(doc).toContain("edit_walls");
  });
});

describe("combat and campaign endings in the persona", () => {
  it("tells the DM to end combat with an outcome and to end the campaign only when the story is over", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    expect(text).toContain("victory_hint");
    expect(text).toMatch(/end_combat[^\n]*outcome/);
    expect(text).toMatch(/fled/);
    expect(text).toMatch(/defeat/);
    expect(text).toContain("end_campaign");
    expect(text).toMatch(/end_campaign[^\n]*epilogue/);
    expect(text).toMatch(/end_campaign[\s\S]{0,300}\b(never|not)\b[\s\S]{0,80}(combat|fight)/i);
  });
});

describe("campaign status in the instructions (bug: host-end-campaign-dm-unaware)", () => {
  it("says nothing while the campaign is active", () => {
    expect(buildInstructions(campaign(), emptyGameState("cmp_1"))).not.toMatch(/CAMPAIGN (COMPLETE|ENDED)/);
  });

  it("tells the DM the campaign is over when it is completed or failed", () => {
    const done = { ...campaign(), status: "completed" as const };
    expect(buildInstructions(done, emptyGameState("cmp_1"))).toMatch(/CAMPAIGN COMPLETE/);
    const failed = { ...campaign(), status: "failed" as const };
    expect(buildInstructions(failed, emptyGameState("cmp_1"))).toMatch(/CAMPAIGN ENDED.*fail/i);
  });
});
