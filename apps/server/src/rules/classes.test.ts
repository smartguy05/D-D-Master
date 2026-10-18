import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CLASS_HIT_DIE, DEFAULT_ABILITIES, proficiencyBonusFor } from "@dm/shared";
import { ClassCatalog } from "./classes.js";

const SRD_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../data/srd");

const CLASSES = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"];

describe("ClassCatalog (real SRD data)", () => {
  const classes = new ClassCatalog();
  classes.load(SRD_DIR);

  it("parses all 12 classes with 20 levels each, matching the shared hit die and PB tables", () => {
    expect(classes.names()).toEqual(CLASSES);
    for (const name of CLASSES) {
      const c = classes.get(name)!;
      expect(c.levels, name).toHaveLength(20);
      expect(c.hitDie, name).toBe(CLASS_HIT_DIE[name.toLowerCase()]);
      c.levels.forEach((l, i) => {
        expect(l.level).toBe(i + 1);
        expect(l.proficiencyBonus, `${name} ${l.level}`).toBe(proficiencyBonusFor(l.level));
      });
      expect(c.subclass?.features.length, name).toBeGreaterThan(0);
      expect(c.features.length, name).toBeGreaterThan(5);
    }
  });

  it("caster kinds and spellcasting abilities", () => {
    const kinds = Object.fromEntries(CLASSES.map((n) => [n, classes.get(n)!.spellcasting?.kind ?? "none"]));
    expect(kinds).toEqual({
      Barbarian: "none", Bard: "full", Cleric: "full", Druid: "full", Fighter: "none", Monk: "none",
      Paladin: "half", Ranger: "half", Rogue: "none", Sorcerer: "full", Warlock: "pact", Wizard: "full",
    });
    expect(classes.get("Wizard")!.spellcasting?.ability).toBe("int");
    expect(classes.get("Warlock")!.spellcasting?.ability).toBe("cha");
    expect(classes.get("Cleric")!.spellcasting?.ability).toBe("wis");
    expect(classes.get("Bard")!.spellcasting?.ability).toBe("cha");
  });

  it("spell slots: Wizard 5, Paladin 5, Warlock 5, Wizard 20", () => {
    expect(classes.level("Wizard", 5)!.slots).toEqual([4, 3, 2]);
    expect(classes.level("Wizard", 1)!.slots).toEqual([2]);
    expect(classes.level("Wizard", 20)!.slots).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
    expect(classes.level("Paladin", 5)!.slots).toEqual([4, 2]);
    const wl = classes.level("Warlock", 5)!;
    expect(wl.slots).toEqual([]);
    expect(wl.pact).toEqual({ slots: 2, slotLevel: 3 });
    expect(classes.level("Warlock", 1)!.pact).toEqual({ slots: 1, slotLevel: 1 });
    expect(classes.level("Fighter", 5)!.slots).toEqual([]);
    expect(classes.level("Wizard", 5)).toMatchObject({ cantrips: 4, preparedSpells: 9 });
  });

  it("Barbarian 3 features and Rage count", () => {
    const l3 = classes.level("barbarian", 3)!;
    expect(l3.features).toEqual(["Barbarian Subclass", "Primal Knowledge"]);
    expect(l3.resources).toEqual({ Rage: 3 });
    expect(l3.columns["Rage Damage"]).toBe("+2");
    expect(classes.level("Warlock", 5)!.features).toEqual([]);
    const rage = classes.resourcesFor("Barbarian", 3, DEFAULT_ABILITIES);
    expect(rage).toEqual([{ name: "Rage", max: 3, resetOn: "long", shortRestRegain: 1 }]);
  });

  it("class resources: Sorcery Points, Focus Points, Channel Divinity, fighter", () => {
    const names = (c: string, l: number, ab = DEFAULT_ABILITIES) => classes.resourcesFor(c, l, ab).map((r) => r.name);
    expect(classes.resourcesFor("Sorcerer", 1, DEFAULT_ABILITIES)).toEqual([{ name: "Innate Sorcery", max: 2, resetOn: "long" }]);
    expect(classes.resourcesFor("Sorcerer", 5, DEFAULT_ABILITIES)).toEqual([
      { name: "Sorcery Points", max: 5, resetOn: "long" },
      { name: "Innate Sorcery", max: 2, resetOn: "long" },
      { name: "Sorcerous Restoration", max: 1, resetOn: "long", note: expect.stringMatching(/half your Sorcerer level/) },
    ]);
    expect(classes.resourcesFor("Monk", 1, DEFAULT_ABILITIES)).toEqual([]);
    expect(classes.resourcesFor("Monk", 4, DEFAULT_ABILITIES)).toEqual([
      { name: "Focus Points", max: 4, resetOn: "short" },
      { name: "Uncanny Metabolism", max: 1, resetOn: "long", note: expect.stringMatching(/Initiative/) },
    ]);
    expect(classes.resourcesFor("Cleric", 2, DEFAULT_ABILITIES)).toEqual([
      { name: "Channel Divinity", max: 2, resetOn: "long", shortRestRegain: 1 },
    ]);
    expect(classes.resourcesFor("Cleric", 18, DEFAULT_ABILITIES)[0]).toMatchObject({ name: "Channel Divinity", max: 4 });
    expect(classes.resourcesFor("Fighter", 17, DEFAULT_ABILITIES)).toEqual([
      { name: "Second Wind", max: 4, resetOn: "long", shortRestRegain: 1 },
      { name: "Action Surge", max: 2, resetOn: "short" },
      { name: "Indomitable", max: 3, resetOn: "long" },
    ]);
    expect(classes.resourcesFor("Paladin", 4, DEFAULT_ABILITIES).map(({ name, max, resetOn }) => ({ name, max, resetOn }))).toEqual([
      { name: "Channel Divinity", max: 2, resetOn: "long" },
      { name: "Lay On Hands", max: 20, resetOn: "long" },
      { name: "Paladin's Smite", max: 1, resetOn: "long" },
    ]);
    expect(classes.resourcesFor("Bard", 1, { ...DEFAULT_ABILITIES, cha: 16 })).toEqual([{ name: "Bardic Inspiration", max: 3, resetOn: "long" }]);
    expect(classes.resourcesFor("Bard", 18, DEFAULT_ABILITIES)[0]).toMatchObject({ resetOn: "short", note: expect.stringMatching(/Initiative/) });
    expect(classes.resourcesFor("Druid", 2, DEFAULT_ABILITIES)).toEqual([{ name: "Wild Shape", max: 2, resetOn: "long", shortRestRegain: 1 }]);
    expect(names("Ranger", 1)).toEqual(["Favored Enemy"]);
    expect(names("Wizard", 1)).toEqual(["Arcane Recovery"]);
    expect(classes.resourcesFor("Rogue", 20, DEFAULT_ABILITIES)).toEqual([{ name: "Stroke of Luck", max: 1, resetOn: "short" }]);
    expect(classes.resourcesFor("Artificer", 3, DEFAULT_ABILITIES)).toEqual([]);
  });

  it("more class resources: Tireless, Mystic Arcanum, Contact Patron, Faithful Steed, Persistent Rage …", () => {
    const names = (c: string, l: number, ab = DEFAULT_ABILITIES) => classes.resourcesFor(c, l, ab).map((r) => r.name);
    const wis16 = { ...DEFAULT_ABILITIES, wis: 16 };
    expect(classes.resourcesFor("Ranger", 10, wis16).find((r) => r.name === "Tireless")).toMatchObject({ max: 3, resetOn: "long" });
    expect(classes.resourcesFor("Ranger", 14, DEFAULT_ABILITIES).find((r) => r.name === "Nature's Veil")?.max).toBe(1);
    expect(names("Ranger", 9)).not.toContain("Tireless");
    expect(names("Warlock", 11)).toContain("Mystic Arcanum (level 6)");
    expect(names("Warlock", 11)).not.toContain("Mystic Arcanum (level 7)");
    expect(names("Warlock", 17).filter((n) => n.startsWith("Mystic Arcanum"))).toEqual([
      "Mystic Arcanum (level 6)", "Mystic Arcanum (level 7)", "Mystic Arcanum (level 8)", "Mystic Arcanum (level 9)",
    ]);
    expect(names("Warlock", 9)).toContain("Contact Patron");
    expect(names("Warlock", 8)).not.toContain("Contact Patron");
    expect(names("Paladin", 5)).toContain("Faithful Steed");
    expect(names("Barbarian", 15)).toEqual(["Rage", "Persistent Rage"]);
    expect(names("Barbarian", 14)).toEqual(["Rage"]);
    expect(names("Druid", 5)).toContain("Wild Resurgence");
    expect(classes.resourcesFor("Wizard", 20, DEFAULT_ABILITIES).find((r) => r.name === "Signature Spells")).toMatchObject({ max: 2, resetOn: "short" });
    expect(classes.resourcesFor("Wizard", 1, DEFAULT_ABILITIES)[0].note).toMatch(/Short Rest/);
  });

  it("Magical Cunning starts at Warlock level 2", () => {
    expect(classes.resourcesFor("Warlock", 1, DEFAULT_ABILITIES)).toEqual([]);
    expect(classes.resourcesFor("Warlock", 2, DEFAULT_ABILITIES).map((r) => r.name)).toEqual(["Magical Cunning"]);
  });

  it("subclass resources only for the matching SRD subclass", () => {
    const wis16 = { ...DEFAULT_ABILITIES, wis: 16 };
    expect(classes.resourcesFor("Monk", 6, wis16, "Warrior of the Open Hand").find((r) => r.name === "Wholeness of Body")?.max).toBe(3);
    expect(classes.resourcesFor("Monk", 6, wis16).map((r) => r.name)).not.toContain("Wholeness of Body");
    expect(classes.resourcesFor("Monk", 6, wis16, "Warrior of Shadow").map((r) => r.name)).not.toContain("Wholeness of Body");
    expect(classes.resourcesFor("Druid", 6, DEFAULT_ABILITIES, "circle of the land").map((r) => r.name)).toEqual(
      expect.arrayContaining(["Natural Recovery (spell)", "Natural Recovery (slots)"]),
    );
    expect(classes.resourcesFor("Warlock", 6, { ...DEFAULT_ABILITIES, cha: 18 }, "Fiend Patron").find((r) => r.name === "Dark One's Own Luck")?.max).toBe(4);
    expect(classes.resourcesFor("Barbarian", 14, DEFAULT_ABILITIES, "Path of the Berserker").map((r) => r.name)).toContain("Intimidating Presence");
  });

  it("levels are clamped once: 21 acts as 20, below 1 gives nothing", () => {
    expect(classes.resourcesFor("Paladin", 21, DEFAULT_ABILITIES).find((r) => r.name === "Lay On Hands")?.max).toBe(100);
    expect(classes.resourcesFor("Barbarian", 0, DEFAULT_ABILITIES)).toEqual([]);
    expect(classes.resourcesFor("Barbarian", -3, DEFAULT_ABILITIES)).toEqual([]);
    expect(classes.resourcesFor("Barbarian", Number.NaN, DEFAULT_ABILITIES)).toEqual([]);
  });

  it("feature text lookup covers class and subclass features", () => {
    const barb = classes.get("Barbarian")!;
    expect(barb.subclass?.name).toBe("Path of the Berserker");
    expect(barb.subclass?.features.find((f) => f.name === "Frenzy")?.level).toBe(3);
    expect(barb.featureText("rage")).toMatch(/Bonus Action/);
    expect(barb.featureText("Frenzy")).toBeTruthy();
    expect(barb.featureText("Nope")).toBeUndefined();
    expect(classes.featureText("Wizard", "Arcane Recovery")).toMatch(/Short Rest/);
    expect(barb.features.find((f) => f.name === "Rage")!.text.length).toBeLessThanOrEqual(400);
    // table names carry use-count suffixes and curly apostrophes
    expect(classes.featureText("Fighter", "Action Surge (one use)")).toBeDefined();
    expect(classes.featureText("Warlock", "Mystic Arcanum (level 6 spell)")).toBeDefined();
    expect(classes.featureText("Ranger", "Nature’s Veil")).toBeDefined();
    expect(classes.featureText("Ranger", "Nature's Veil")).toBeDefined();
  });
});
