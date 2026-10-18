import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spellEffectAt } from "@dm/shared";
import { parseSpellBlock, SpellCatalog } from "./spells.js";

const SRD_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../data/srd");

describe("SpellCatalog (real SRD data)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);

  it("parses every SRD spell and only spells", () => {
    expect(spells.size).toBeGreaterThanOrEqual(300);
    expect(spells.size).toBe(339);
    for (const bad of ["Spell Slots", "Casting without Slots", "Using a Higher-Level Spell Slot", "Actions", "Traits", "Animated Object"]) {
      expect(spells.get(bad)).toBeUndefined();
    }
  });

  it("Fireball: L3 DEX save, 8d6 fire in a 20-ft sphere, +1d6 per slot above 3", () => {
    const s = spells.find("fireball")!;
    expect(s).toMatchObject({ name: "Fireball", level: 3, school: "Evocation", save: "dex", concentration: false, ritual: false });
    expect(s.classes).toEqual(["Sorcerer", "Wizard"]);
    expect(s.damage).toEqual([{ dice: "8d6", type: "fire" }]);
    expect(s.area).toEqual({ shape: "sphere", sizeFt: 20 });
    expect(s.upcast).toMatchObject({ perLevelDice: "1d6", appliesTo: "damage" });
    expect(spellEffectAt(s, { slotLevel: 5 }).damage[0].dice).toBe("10d6");
  });

  it("Fire Bolt: cantrip, ranged attack, scaling", () => {
    const s = spells.find("Fire Bolt")!;
    expect(s).toMatchObject({ level: 0, attack: "ranged", damage: [{ dice: "1d10", type: "fire" }] });
    expect(s.save).toBeUndefined();
    expect(s.cantripScaling?.tiers).toEqual([
      { level: 5, dice: "2d10" },
      { level: 11, dice: "3d10" },
      { level: 17, dice: "4d10" },
    ]);
    expect(spellEffectAt(s, { casterLevel: 5 }).damage[0].dice).toBe("2d10");
  });

  it("Eldritch Blast scales by beams", () => {
    const s = spells.find("Eldritch Blast")!;
    expect(s.cantripScaling?.tiers).toEqual([
      { level: 5, projectiles: 2 },
      { level: 11, projectiles: 3 },
      { level: 17, projectiles: 4 },
    ]);
    expect(spellEffectAt(s, { casterLevel: 11 }).projectiles).toBe(3);
  });

  it("Bless: concentration; Shield: reaction; Detect Magic: ritual", () => {
    expect(spells.find("Bless")).toMatchObject({ concentration: true, level: 1 });
    expect(spells.find("Bless")!.upcast?.perLevelTargets).toBe(1);
    expect(spells.find("Shield")).toMatchObject({ reaction: true, concentration: false, level: 1 });
    expect(spells.find("Detect Magic")).toMatchObject({ ritual: true, concentration: true });
    expect(spells.find("Healing Word")).toMatchObject({ bonusAction: true });
  });

  it("Cure Wounds heals 2d8 + mod, +2d8 per slot", () => {
    const s = spells.find("Cure Wounds")!;
    expect(s.heal).toEqual({ dice: "2d8", addMod: true });
    expect(s.damage).toEqual([]);
    expect(s.upcast).toMatchObject({ perLevelDice: "2d8", appliesTo: "heal" });
    expect(spellEffectAt(s, { slotLevel: 3 }).heal).toEqual({ dice: "6d8", addMod: true });
  });

  it("Heal is a flat 70 HP (+10 per slot); Chromatic Orb damage type is a choice", () => {
    const heal = spells.find("Heal")!;
    expect(heal.heal).toEqual({ dice: "70", addMod: false });
    expect(spellEffectAt(heal, { slotLevel: 8 }).heal?.dice).toBe("90");
    expect(spells.find("Chromatic Orb")!.damage).toEqual([{ dice: "3d8", type: "choice" }]);
  });

  it("Magic Missile: three 1d4+1 force darts, one more per slot", () => {
    const s = spells.find("Magic Missile")!;
    expect(s.damage).toEqual([{ dice: "1d4+1", type: "force" }]);
    expect(s.projectiles).toBe(3);
    expect(s.upcast?.perLevelProjectiles).toBe(1);
    const at3 = spellEffectAt(s, { slotLevel: 3 });
    expect(at3.projectiles).toBe(5);
    expect(at3.damage[0].dice).toBe("1d4+1");
  });

  it("Hold Person: concentration, WIS save, extra target per slot", () => {
    const s = spells.find("Hold Person")!;
    expect(s).toMatchObject({ level: 2, concentration: true, save: "wis" });
    expect(s.upcast?.perLevelTargets).toBe(1);
  });

  it("Lightning Bolt line and Scorching Ray rays", () => {
    expect(spells.find("Lightning Bolt")!.area).toEqual({ shape: "line", sizeFt: 100, widthFt: 5 });
    expect(spells.find("Burning Hands")!.area).toEqual({ shape: "cone", sizeFt: 15 });
    const ray = spells.find("Scorching Ray")!;
    expect(ray).toMatchObject({ attack: "ranged", projectiles: 3, damage: [{ dice: "2d6", type: "fire" }] });
    expect(ray.upcast?.perLevelProjectiles).toBe(1);
    expect(spells.find("Sacred Flame")).toMatchObject({ save: "dex", damage: [{ dice: "1d8", type: "radiant" }] });
  });

  it("find tolerates case, punctuation and prefixes", () => {
    expect(spells.find("  MAGIC missile ")?.name).toBe("Magic Missile");
    expect(spells.find("Cure Wound")?.name).toBe("Cure Wounds");
    expect(spells.find("")).toBeUndefined();
    expect(spells.find("Definitely Not A Spell")).toBeUndefined();
    expect(spells.names()).toContain("Wish");
  });
});

describe("parseSpellBlock", () => {
  it("rejects headings without a level/school line", () => {
    expect(parseSpellBlock("Actions", "_Slam._ _Melee Attack Roll:_ Bonus equals your spell attack modifier")).toBeUndefined();
    expect(parseSpellBlock("Spell Slots", "Spellcasting is taxing, so a spellcaster can cast only a limited number")).toBeUndefined();
  });
});
