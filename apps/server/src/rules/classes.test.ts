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
    expect(classes.resourcesFor("Sorcerer", 1, DEFAULT_ABILITIES)).toEqual([{ name: "Innate Sorcery", max: 2, resetOn: "long" }]);
    expect(classes.resourcesFor("Sorcerer", 5, DEFAULT_ABILITIES)).toEqual([
      { name: "Sorcery Points", max: 5, resetOn: "long" },
      { name: "Innate Sorcery", max: 2, resetOn: "long" },
      { name: "Sorcerous Restoration", max: 1, resetOn: "long" },
    ]);
    expect(classes.resourcesFor("Monk", 1, DEFAULT_ABILITIES)).toEqual([]);
    expect(classes.resourcesFor("Monk", 4, DEFAULT_ABILITIES)).toEqual([
      { name: "Focus Points", max: 4, resetOn: "short" },
      { name: "Uncanny Metabolism", max: 1, resetOn: "long" },
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
    expect(classes.resourcesFor("Paladin", 4, DEFAULT_ABILITIES)).toEqual([
      { name: "Channel Divinity", max: 2, resetOn: "long", shortRestRegain: 1 },
      { name: "Lay On Hands", max: 20, resetOn: "long" },
    ]);
    expect(classes.resourcesFor("Bard", 1, { ...DEFAULT_ABILITIES, cha: 16 })).toEqual([{ name: "Bardic Inspiration", max: 3, resetOn: "long" }]);
    expect(classes.resourcesFor("Druid", 2, DEFAULT_ABILITIES)).toEqual([{ name: "Wild Shape", max: 2, resetOn: "long", shortRestRegain: 1 }]);
    expect(classes.resourcesFor("Ranger", 1, DEFAULT_ABILITIES)).toEqual([{ name: "Favored Enemy", max: 2, resetOn: "long" }]);
    expect(classes.resourcesFor("Wizard", 1, DEFAULT_ABILITIES)).toEqual([{ name: "Arcane Recovery", max: 1, resetOn: "long" }]);
    expect(classes.resourcesFor("Rogue", 20, DEFAULT_ABILITIES)).toEqual([{ name: "Stroke of Luck", max: 1, resetOn: "short" }]);
    expect(classes.resourcesFor("Artificer", 3, DEFAULT_ABILITIES)).toEqual([]);
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
  });
});
