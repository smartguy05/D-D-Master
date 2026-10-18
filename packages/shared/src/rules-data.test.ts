import { describe, expect, it } from "vitest";
import {
  addDice,
  CLASS_HIT_DIE,
  hitDieFor,
  proficiencyBonusFor,
  resourcesFor,
  spellEffectAt,
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
  damage: [{ dice: "8d6", type: "fire" }],
  area: { shape: "sphere", sizeFt: 20 },
  upcast: { text: "", perLevelDice: "1d6", appliesTo: "damage" },
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
    expect(spellEffectAt(fireball, { slotLevel: 5 }).damage).toEqual([{ dice: "10d6", type: "fire" }]);
    expect(spellEffectAt(fireball, {}).damage).toEqual([{ dice: "8d6", type: "fire" }]);
  });

  it("scales a cantrip by caster level", () => {
    const bolt: SpellInfo = {
      ...fireball,
      name: "Fire Bolt",
      level: 0,
      save: undefined,
      attack: "ranged",
      damage: [{ dice: "1d10", type: "fire" }],
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
    expect(high).toEqual([{ name: "Bardic Inspiration", max: 4, resetOn: "short" }]);
  });
});
