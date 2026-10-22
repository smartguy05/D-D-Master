import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { OriginCatalog } from "./origins.js";

const SRD_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../data/srd");

describe("OriginCatalog (real SRD data)", () => {
  const o = new OriginCatalog();
  o.load(SRD_DIR);

  it("backgrounds: abilities, Origin feat, skills, tool and equipment packages", () => {
    expect(o.backgroundNames()).toEqual(["Acolyte", "Criminal", "Sage", "Soldier"]);
    const acolyte = o.background("acolyte")!;
    expect(acolyte).toMatchObject({ name: "Acolyte", abilities: ["int", "wis", "cha"], feat: "Magic Initiate (Cleric)", skills: ["Insight", "Religion"], tool: "Calligrapher's Supplies" });
    expect(acolyte.equipment[0].items).toContainEqual({ name: "Holy Symbol", qty: 1 });
    expect(acolyte.equipment[0].gold).toBe(8);
    expect(acolyte.equipment[1]).toEqual({ letter: "B", items: [], gold: 50 });
    expect(o.background("Criminal")!.equipment[0].items).toContainEqual({ name: "Dagger", qty: 2 });
    expect(o.background("Soldier")).toMatchObject({ abilities: ["str", "dex", "con"], feat: "Savage Attacker", skills: ["Athletics", "Intimidation"], tool: "Choose one kind of Gaming Set" });
  });

  it("species: speed, darkvision and traits", () => {
    expect(o.speciesNames()).toEqual(["Dragonborn", "Dwarf", "Elf", "Gnome", "Goliath", "Halfling", "Human", "Orc", "Tiefling"]);
    expect(o.species("Dwarf")).toMatchObject({ speed: 30, darkvision: 120, choices: [] });
    expect(o.species("Dwarf")!.traits.map((t) => t.name)).toEqual(["Darkvision", "Dwarven Resilience", "Dwarven Toughness", "Stonecunning"]);
    expect(o.species("Goliath")!.speed).toBe(35);
    expect(o.species("Halfling")!.darkvision).toBeUndefined();
    expect(o.species("Tiefling")!.cantrips).toEqual(["Thaumaturgy"]);
  });

  it("species choices: lineages with their spells, ancestries, size, skills and the Versatile feat", () => {
    const keys = (n: string) => o.species(n)!.choices.map((c) => `${c.key}:${c.kind}`);
    expect(keys("Dragonborn")).toEqual(["draconic_ancestry:option"]);
    expect(o.species("Dragonborn")!.choices[0].options.map((x) => `${x.name}=${x.text}`)).toEqual(
      ["Black=Acid", "Blue=Lightning", "Brass=Fire", "Bronze=Lightning", "Copper=Acid", "Gold=Fire", "Green=Poison", "Red=Fire", "Silver=Cold", "White=Cold"],
    );
    expect(keys("Elf")).toEqual(["elven_lineage:option", "elven_lineage_ability:ability", "keen_senses:skill"]);
    const [lineage, ability, keen] = o.species("Elf")!.choices;
    expect(lineage.options.find((x) => x.name === "Drow")).toMatchObject({ cantrips: ["Dancing Lights"], spells: [{ level: 3, name: "Faerie Fire" }, { level: 5, name: "Darkness" }], darkvision: 120 });
    expect(lineage.options.find((x) => x.name === "Wood Elf")).toMatchObject({ cantrips: ["Druidcraft"], speed: 35 });
    expect(ability.options.map((x) => x.name)).toEqual(["Intelligence", "Wisdom", "Charisma"]);
    expect(keen.options.map((x) => x.name)).toEqual(["Insight", "Perception", "Survival"]);
    expect(keys("Gnome")).toEqual(["gnomish_lineage:option", "gnomish_lineage_ability:ability"]);
    expect(o.species("Gnome")!.choices[0].options).toEqual([
      expect.objectContaining({ name: "Forest Gnome", cantrips: ["Minor Illusion"], spells: [{ level: 1, name: "Speak with Animals" }] }),
      expect.objectContaining({ name: "Rock Gnome", cantrips: ["Mending", "Prestidigitation"] }),
    ]);
    expect(o.species("Goliath")!.choices[0].options.map((x) => x.name)).toEqual([
      "Cloud's Jaunt (Cloud Giant)", "Fire's Burn (Fire Giant)", "Frost's Chill (Frost Giant)", "Hill's Tumble (Hill Giant)", "Stone's Endurance (Stone Giant)", "Storm's Thunder (Storm Giant)",
    ]);
    expect(keys("Human")).toEqual(["size:size", "skillful:skill", "versatile:feat"]);
    expect(o.species("Human")!.choices[1].options).toHaveLength(18);
    expect(o.species("Human")!.choices[2].options.map((x) => x.name)).toEqual(["Alert", "Magic Initiate", "Savage Attacker", "Skilled"]);
    expect(keys("Tiefling")).toEqual(["size:size", "fiendish_legacy:option", "fiendish_legacy_ability:ability"]);
    expect(o.species("Tiefling")!.choices[1].options.find((x) => x.name === "Infernal")).toMatchObject({ cantrips: ["Fire Bolt"], spells: [{ level: 3, name: "Hellish Rebuke" }, { level: 5, name: "Darkness" }] });
    expect(keys("Halfling")).toEqual([]);
  });

  it("feats by category, repeatable, and the +1 a general feat gives", () => {
    expect(o.feats("origin").map((f) => f.name)).toEqual(["Alert", "Magic Initiate", "Savage Attacker", "Skilled"]);
    expect(o.feat("Magic Initiate (Cleric)")).toMatchObject({ name: "Magic Initiate", repeatable: true });
    expect(o.feat("Grappler")).toMatchObject({ category: "general", abilities: ["str", "dex"] });
    expect(o.feat("Ability Score Improvement")).toMatchObject({ category: "general", repeatable: true });
    expect(o.feats("fighting_style").map((f) => f.name)).toEqual(["Archery", "Defense", "Great Weapon Fighting", "Two-Weapon Fighting"]);
    expect(o.feat("Boon of Combat Prowess")?.category).toBe("epic");
  });
});
