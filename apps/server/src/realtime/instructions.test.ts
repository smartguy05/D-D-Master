import { describe, expect, it } from "vitest";
import { Campaign, Character, Location, Monster, emptyGameState } from "@dm/shared";
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
    s.featureEdits = { loc_nave: { mapUrl: "/m/1.png", features: [{ name: "pews", kind: "feature", lit: false, blocks: true, interactive: false, x: 4, y: 3, w: 1, h: 1 }] } };
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

describe("movement and map areas in the DM instructions (bug: move-narrated-through-wall)", () => {
  it("says the party's real entrance, not always the left edge", () => {
    const c = campaign();
    c.outline!.locations.push(
      Location.parse({ id: "loc_mill", name: "Mill", gridW: 20, gridH: 14, features: [{ name: "Lit doorway (east)", kind: "entrance", x: 16, y: 7, w: 4, h: 7 }] }),
      Location.parse({ id: "loc_field", name: "Field", gridW: 12, gridH: 10 }),
    );
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_mill";
    const text = buildInstructions(c, s);
    expect(text).toContain("the party enters by Lit doorway (east) at x 17, y 10");
    expect(text).not.toContain("enters from the left edge");
    s.locationId = "loc_field";
    expect(buildInstructions(c, s)).toContain("the party enters from the left edge");
  });

  it("tells the DM to move tokens whenever the story moves someone, and to change_scene when players leave", () => {
    const text = buildInstructions(undefined, emptyGameState("c1"));
    expect(text).toContain("move_party {to: a map feature} for the group");
    expect(text).toContain("Never describe anyone walking somewhere while their token stays put");
    expect(text).toContain("that is leaving: start the ready check with change_scene right away");
  });

  it("tells the DM move_token routes by itself, to narrate only its result, and that it may rule past terrain", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    expect(text).toContain("move_token walks around walls");
    expect(text).toMatch(/returns an error the creature did not move/);
    expect(text).toContain("ignore_terrain=true");
    expect(text).toContain("final rules authority");
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

describe("death rule in the instructions (bug: campaign-fails-on-single-pc-death)", () => {
  it("tells the DM one death never ends the campaign and states the campaign's rule", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    expect(text).toMatch(/end_campaign[\s\S]{0,400}never[^\n]*one (PC|player character) died/i);
    expect(text).toMatch(/Death rule: the campaign fails only when every player character is dead/);
    const harsh = { ...campaign(), deathRule: "any_death" as const };
    expect(buildInstructions(harsh, emptyGameState("cmp_1"))).toMatch(/Death rule: the first player character death ends the campaign/);
  });

  it("states no death rule once the campaign is over", () => {
    const failed = { ...campaign(), status: "failed" as const };
    expect(buildInstructions(failed, emptyGameState("cmp_1"))).not.toMatch(/Death rule:/);
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

describe("map objects in the DM instructions (G2)", () => {
  type Obj = { id: string; locationId: string; kind: "loot" | "interactable"; name: string; x: number; y: number; items: Array<{ id: string; name: string; qty: number }>; gold: number; discovered: boolean; used: boolean; hidden: boolean };
  const obj = (o: Partial<Obj>): Obj => ({ id: "obj_x", locationId: "loc_vault", kind: "loot", name: "Loot", x: 0, y: 0, items: [], gold: 0, discovered: true, used: false, hidden: false, ...o });
  function setup(objs: Obj[]) {
    const c = campaign();
    c.outline!.locations.push(Location.parse({ id: "loc_vault", name: "Vault", gridW: 12, gridH: 10 }));
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_vault";
    (s as unknown as { mapObjects: Obj[] }).mapObjects = objs;
    return buildInstructions(c, s);
  }

  it("lists the current location's objects with id, kind, name, cell and contents", () => {
    const text = setup([
      obj({ id: "obj_loot1", name: "Goblin's loot", x: 6, y: 4, items: [{ id: "i1", name: "Dagger", qty: 2 }, { id: "i2", name: "Gem", qty: 1 }], gold: 15 }),
      obj({ id: "obj_lever1", kind: "interactable", name: "Sluice lever", x: 9, y: 2, used: true }),
      obj({ id: "obj_latch1", kind: "interactable", name: "Secret latch", x: 1, y: 1, hidden: true }),
      obj({ id: "obj_far", locationId: "loc_other", name: "Far loot", gold: 3 }),
    ]);
    expect(text).toMatch(/^Objects here/m);
    const lines = text.split("\n");
    const loot = lines.find((l) => l.includes("obj_loot1"))!;
    expect(loot).toBeDefined();
    for (const t of ["loot", "Goblin's loot", "6", "4", "Dagger x2", "Gem", "15 gp"]) expect(loot).toContain(t);
    const lever = lines.find((l) => l.includes("obj_lever1"))!;
    expect(lever).toContain("interactable");
    expect(lever).toContain("Sluice lever");
    expect(lever).toMatch(/\bused\b/);
    expect(lever).not.toMatch(/\bhidden\b/);
    const latch = lines.find((l) => l.includes("obj_latch1"))!;
    expect(latch).toMatch(/\bhidden\b/);
    expect(text).not.toContain("obj_far");
    expect(text).not.toContain("Far loot");
  });

  it("has no block without objects at the current location", () => {
    expect(setup([])).not.toMatch(/^Objects here/m);
    expect(setup([obj({ id: "obj_far", locationId: "loc_other" })])).not.toMatch(/^Objects here/m);
  });
});

describe("loot and interactables in the persona (G3)", () => {
  it("tells the DM when to drop loot, pick it up and use interactables", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    for (const t of ["drop_loot", "pick_up", "place_interactable", "set_interactable"]) expect(text).toContain(t);
    expect(text).toMatch(/drop_loot[\s\S]{0,300}remove_monster/);
    expect(text).toMatch(/interactive/i);
  });
});

describe("tool catalog doc (G4)", () => {
  it("documents the loot and interactable tools", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const doc = readFileSync(fileURLToPath(new URL("../../../../docs/reference/tool-catalog.md", import.meta.url)), "utf8");
    for (const t of ["drop_loot", "pick_up", "place_interactable", "set_interactable", "remove_map_object"]) expect(doc).toContain(t);
  });
});

describe("NPC attitudes and Influence (Phase 4)", () => {
  it("teaches the 2024 Influence rules and adjust_attitude", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"));
    expect(text).toContain("adjust_attitude");
    expect(text).toContain("Influence");
    expect(text).toContain("DC 15");
    expect(text).toMatch(/Intelligence/);
    expect(text).toMatch(/Willing/);
    expect(text).toMatch(/Unwilling/);
    expect(text).toMatch(/Hesitant/);
    expect(text).toMatch(/Advantage/);
    expect(text).toMatch(/Disadvantage/);
    expect(text).toMatch(/24 hours/);
    expect(text).toMatch(/Animal Handling/);
    expect(text).toContain("set_disposition");
    // Not the old made-up scale.
    expect(text).not.toMatch(/Hostile: high DC/i);
  });

  it("lists the creatures on the map with their attitude (derived for old saves)", () => {
    const c = campaign();
    c.outline!.locations.push(Location.parse({ id: "loc_dock", name: "Dock", gridW: 12, gridH: 8 }));
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_dock";
    s.monsters.push(
      Monster.parse({ id: "mon_pell", name: "Pell Netter", maxHp: 4, hp: 4, npc: true, ally: true, combatant: false }),
      Monster.parse({ id: "mon_grub", name: "Grub", maxHp: 7, hp: 7 }),
      Monster.parse({ id: "mon_tikk", name: "Tikk", maxHp: 4, hp: 4, neutral: true, attitudeScore: 1 }),
    );
    s.tokens.push(
      { id: "tok_1", entityId: "mon_pell", entityType: "monster", x: 1, y: 1, size: 1 },
      { id: "tok_2", entityId: "mon_grub", entityType: "monster", x: 5, y: 1, size: 1 },
      { id: "tok_3", entityId: "mon_tikk", entityType: "monster", x: 6, y: 2, size: 1 },
    );
    const text = buildInstructions(c, s);
    expect(text).toContain("- Pell Netter (mon_pell): Friendly (+3)");
    expect(text).toContain("- Grub (mon_grub): Hostile (-3)");
    expect(text).toContain("- Tikk (mon_tikk): Indifferent (+1)");
  });
});

describe("NPC voice lines (NPC_TTS on)", () => {
  it("voices every quoted NPC line, not sparingly", () => {
    const text = buildInstructions(campaign(), emptyGameState("cmp_1"), { npcTts: true });
    expect(text).toContain("speak_as_npc");
    expect(text).not.toMatch(/sparingly/i);
    expect(text).not.toMatch(/once per scene/i);
    expect(text).toMatch(/every[^.\n]*NPC line/i);
    expect(text).toMatch(/one or two sentences/i);
    expect(text).toMatch(/narrat/i);
    expect(text).toMatch(/(don't|do not|never) repeat/i);
  });

  it("says nothing about speak_as_npc when NPC TTS is off", () => {
    expect(buildInstructions(campaign(), emptyGameState("cmp_1"), { npcTts: false })).not.toContain("speak_as_npc");
  });
});

describe("party split in the instructions", () => {
  function splitState() {
    const c = campaign();
    c.outline!.locations.push(Location.parse({ id: "loc_hall", name: "Hall" }), Location.parse({ id: "loc_mill", name: "Old Mill" }));
    const s = emptyGameState("cmp_1");
    s.locationId = "loc_hall";
    s.characters.push(
      Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 10 }),
      Character.parse({ id: "pc_c", playerName: "Kim", name: "Bram", maxHp: 10, hp: 10 }),
    );
    s.scenes.loc_mill = {
      tokens: [],
      monsters: [],
      combat: { active: true, round: 2, turnIndex: 0, order: [{ entityId: "pc_c", entityType: "character", name: "Bram", initiative: 12 }], turn: null, reactionsUsed: [], announced: [] },
    };
    s.partyLocations = { pc_c: "loc_mill" };
    return { c, s };
  }

  it("labels the focused scene, lists the other groups and tags away PCs", () => {
    const { c, s } = splitState();
    const text = buildInstructions(c, s);
    expect(text).toContain("CURRENT LOCATION (IN FOCUS): Hall");
    expect(text).toContain("OTHER GROUPS (waiting off screen; focus_scene <id> to cut to them):\n- Bram at Old Mill (loc_mill): in combat, round 2, Bram's turn (frozen)");
    expect(text).toMatch(/- Bram \[id pc_c\] \[at Old Mill, not in focus\] played by Kim/);
    expect(text).toMatch(/- Thorin \[id pc_a\] played by Sam/);
  });

  it("says nothing about groups while the party is together, but always explains splitting", () => {
    const { c, s } = splitState();
    s.scenes = {};
    s.partyLocations = {};
    const text = buildInstructions(c, s);
    expect(text).not.toContain("OTHER GROUPS (");
    expect(text).toContain("CURRENT LOCATION: Hall");
    expect(text).toMatch(/SPLIT PARTY\n- When only some characters go somewhere, call change_scene with character_ids/);
    expect(text).toMatch(/finish the round before you cut away/);
  });
});
