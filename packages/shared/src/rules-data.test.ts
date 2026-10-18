import { describe, expect, it } from "vitest";
import {
  addDice,
  CLASS_HIT_DIE,
  hitDieFor,
  primaryDamage,
  proficiencyBonusFor,
  resourcesFor,
  spellEffectAt,
  subclassMatches,
  type ClassInfo,
  type SpellInfo,
} from "./rules-data.js";
import { DEFAULT_ABILITIES } from "./schemas.js";

const fireball: SpellInfo = {
  name: "Fireball",
  level: 3,
  school: "Evocation",
  classes: ["Sorcerer", "Wizard"],
  castingTime: "Action",
  range: "150 feet",
  components: "V, S, M",
  duration: "Instantaneous",
  concentration: false,
  ritual: false,
  reaction: false,
  bonusAction: false,
  save: "dex",
  damage: [{ dice: "8d6", type: "fire", role: "base" }],
  area: { shape: "sphere", sizeFt: 20 },
  upcast: { text: "", perLevelDice: "1d6", appliesTo: "damage", damageIncrements: [{ dice: "1d6" }] },
  summary: "",
};

describe("rules-data helpers", () => {
  it("hit die and proficiency bonus by level", () => {
    expect(CLASS_HIT_DIE.wizard).toBe(6);
    expect(hitDieFor(" Barbarian ")).toBe(12);
    expect(hitDieFor("Artificer")).toBe(8);
    expect([1, 4, 5, 9, 13, 17, 20].map(proficiencyBonusFor)).toEqual([2, 2, 3, 4, 5, 6, 6]);
  });

  it("adds dice of the same size and keeps flat bonuses", () => {
    expect(addDice("8d6", "1d6", 2)).toBe("10d6");
    expect(addDice("1d4+1", "1d4", 0)).toBe("1d4+1");
    expect(addDice("2d8", "1d6", 1)).toBe("2d8+1d6");
    expect(addDice("1d4+1", "1d4", 1)).toBe("2d4+1");
    expect(addDice("70", "10", 2)).toBe("90");
  });

  it("scales a leveled spell by slot level", () => {
    expect(spellEffectAt(fireball, { slotLevel: 5 }).damage).toEqual([{ dice: "10d6", type: "fire", role: "base" }]);
    expect(spellEffectAt(fireball, {}).damage).toEqual([{ dice: "8d6", type: "fire", role: "base" }]);
  });

  it("clamps the slot to 9 and floors it at the spell's level", () => {
    expect(spellEffectAt(fireball, { slotLevel: 9 }).damage[0].dice).toBe("14d6");
    expect(spellEffectAt(fireball, { slotLevel: 15 })).toMatchObject({ castLevel: 9, damage: [{ dice: "14d6" }] });
    expect(spellEffectAt(fireball, { slotLevel: 2 })).toMatchObject({ castLevel: 3, damage: [{ dice: "8d6" }] });
    expect(spellEffectAt(fireball, { slotLevel: -4 })).toMatchObject({ castLevel: 3, damage: [{ dice: "8d6" }] });
  });

  it("applies increments by type, role and index", () => {
    const multi: SpellInfo = {
      ...fireball,
      damage: [
        { dice: "2d6", type: "fire", role: "base" },
        { dice: "2d6", type: "cold", role: "or" },
        { dice: "1d6", type: "fire", role: "later" },
      ],
      upcast: { text: "", appliesTo: "damage", perLevelDice: "1d6", damageIncrements: [{ dice: "1d6" }] },
    };
    expect(spellEffectAt(multi, { slotLevel: 4 }).damage.map((d) => d.dice)).toEqual(["3d6", "3d6", "2d6"]); // default: every role
    const initial: SpellInfo = { ...multi, upcast: { text: "", damageIncrements: [{ dice: "1d6", roles: ["base", "or"] }] } };
    expect(spellEffectAt(initial, { slotLevel: 4 }).damage.map((d) => d.dice)).toEqual(["3d6", "3d6", "1d6"]);
    const typed: SpellInfo = { ...multi, upcast: { text: "", damageIncrements: [{ dice: "1d6", types: ["fire"], roles: ["base", "later"] }] } };
    expect(spellEffectAt(typed, { slotLevel: 4 }).damage.map((d) => d.dice)).toEqual(["3d6", "2d6", "2d6"]);
    const indexed = { ...multi, upcast: { text: "", damageIncrements: [{ dice: "2d6", index: 0 }, { dice: "1d6", index: 2 }] } };
    expect(spellEffectAt(indexed, { slotLevel: 4 }).damage.map((d) => d.dice)).toEqual(["4d6", "2d6", "2d6"]);
  });

  it("primaryDamage keeps base entries and drops alternatives and later hits", () => {
    expect(
      primaryDamage({
        damage: [
          { dice: "1d10", type: "piercing", role: "base" },
          { dice: "2d6", type: "cold", role: "base" },
          { dice: "2d6", type: "fire", role: "or" },
          { dice: "1d6", type: "acid", role: "later" },
        ],
      }).map((d) => d.type),
    ).toEqual(["piercing", "cold"]);
    expect(primaryDamage({ damage: [{ dice: "3d8", type: "radiant", role: "or" }] })).toHaveLength(1);
    expect(primaryDamage({ damage: [] })).toEqual([]);
  });

  it("scales a cantrip by caster level", () => {
    const bolt: SpellInfo = {
      ...fireball,
      name: "Fire Bolt",
      level: 0,
      save: undefined,
      attack: "ranged",
      damage: [{ dice: "1d10", type: "fire", role: "base" }],
      area: undefined,
      upcast: undefined,
      cantripScaling: { text: "", tiers: [{ level: 5, dice: "2d10" }, { level: 11, dice: "3d10" }, { level: 17, dice: "4d10" }] },
    };
    expect(spellEffectAt(bolt, { casterLevel: 1 }).damage[0].dice).toBe("1d10");
    expect(spellEffectAt(bolt, { casterLevel: 11 }).damage[0].dice).toBe("3d10");
    expect(spellEffectAt(bolt, { casterLevel: 20 }).damage[0].dice).toBe("4d10");
  });

  it("derives formula and column resources", () => {
    const bard: ClassInfo = {
      name: "Bard",
      hitDie: 8,
      savingThrows: [],
      spellcasting: { ability: "cha", kind: "full" },
      levels: Array.from({ length: 20 }, (_, i) => ({
        level: i + 1,
        proficiencyBonus: proficiencyBonusFor(i + 1),
        features: [],
        slots: [],
        resources: {},
        columns: {},
      })),
      features: [],
    };
    const low = resourcesFor(bard, 1, { ...DEFAULT_ABILITIES, cha: 8 });
    expect(low).toEqual([{ name: "Bardic Inspiration", max: 1, resetOn: "long" }]);
    const high = resourcesFor(bard, 5, { ...DEFAULT_ABILITIES, cha: 18 });
    expect(high).toEqual([{ name: "Bardic Inspiration", max: 4, resetOn: "short", note: expect.stringMatching(/spell slot/) }]);
  });

  it("subclassMatches: full names, word runs and aliases; stop words never match", () => {
    expect(subclassMatches("Path of the Berserker", "  PATH of the berserker ")).toBe(true);
    expect(subclassMatches("Path of the Berserker", "Berserker")).toBe(true);
    expect(subclassMatches("Warrior of the Open Hand", "open hand")).toBe(true);
    expect(subclassMatches("Warrior of the Open Hand", "Way of the Open Hand")).toBe(true);
    expect(subclassMatches("Circle of the Land", "Land")).toBe(true);
    expect(subclassMatches("Evoker", "Evocation")).toBe(true);
    expect(subclassMatches("Evoker", "School of Evocation")).toBe(true);
    expect(subclassMatches("Fiend Patron", "The Fiend")).toBe(true);
    expect(subclassMatches("Circle of the Land", "of the")).toBe(false);
    expect(subclassMatches("Path of the Berserker", "Bers")).toBe(false); // whole words only
    expect(subclassMatches("Fiend Patron", "Archfey")).toBe(false);
    expect(subclassMatches("Fiend Patron", undefined)).toBe(false);
    expect(subclassMatches("Fiend Patron", "")).toBe(false);
  });

  it.each([
    ["Path of the Berserker", "Path"],
    ["Life Domain", "Domain"],
    ["Circle of the Land", "Circle"],
    ["College of Lore", "College"],
    ["Oath of Devotion", "Oath"],
    ["Fiend Patron", "Patron"],
    ["Draconic Sorcery", "Sorcery"],
    ["Warrior of the Open Hand", "Warrior"],
    ["Path of the Berserker", "Path of the"],
    ["Warrior of the Open Hand", "Hand"],
    ["Warrior of the Open Hand", "Open"],
    ["Circle of the Land", "circle of the"],
  ])("subclassMatches(%j, %j) is false: category nouns and lone generic words name no subclass", (srd, given) => {
    expect(subclassMatches(srd, given)).toBe(false);
  });

  it("a category noun plus a specific word still matches", () => {
    expect(subclassMatches("Warrior of the Open Hand", "Open Hand")).toBe(true);
    expect(subclassMatches("Life Domain", "Life")).toBe(true);
    expect(subclassMatches("Life Domain", "Life Domain")).toBe(true);
    expect(subclassMatches("Circle of the Land", "of the Land")).toBe(true);
    expect(subclassMatches("Draconic Sorcery", "Draconic")).toBe(true);
  });
});
