import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { primaryDamage, spellEffectAt } from "@dm/shared";
import { editDistance, fuzzyDistanceFor, parseSpellBlock, SPELL_ALIASES, SpellCatalog, spellKey } from "./spells.js";

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
    expect(s.damage).toEqual([{ dice: "8d6", type: "fire", role: "base" }]);
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
    expect(spells.find("Chromatic Orb")!.damage).toEqual([{ dice: "3d8", type: "choice", role: "base" }]);
  });

  it("Magic Missile: three 1d4+1 force darts, one more per slot", () => {
    const s = spells.find("Magic Missile")!;
    expect(s.damage).toEqual([{ dice: "1d4+1", type: "force", role: "base" }]);
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
    expect(spells.find("Cure Wound")?.name).toBe("Cure Wounds"); // unique prefix
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

describe("SpellCatalog parse accuracy (review round 1)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);

  it("an upcast line with no blank line before it still counts (Ice Storm, Wall of Ice, Giant Insect)", () => {
    expect(spells.get("Ice Storm")!.upcast?.perLevelDice).toBe("1d10");
    expect(spells.get("Ice Storm")!.upcast?.damageIncrements).toEqual([{ dice: "1d10", types: ["bludgeoning"] }]);
    expect(spells.get("Wall of Ice")!.upcast).toBeDefined();
    expect(spells.get("Giant Insect")!.upcast).toBeDefined();
  });

  it("the first paragraph glued to the Duration line is part of the description", () => {
    expect(spells.get("Heat Metal")!.damage).toContainEqual({ dice: "2d8", type: "fire", role: "base" });
    expect(spells.get("Moonbeam")!.area).toEqual({ shape: "cylinder", sizeFt: 5, heightFt: 40 });
    const charm = spells.get("Charm Monster")!;
    expect(charm.save).toBe("wis");
    expect(charm.summary.length).toBeGreaterThan(20);
  });

  it("'<Type> damage equal to NdM plus your modifier' and 'base damage is NdM'", () => {
    expect(spells.get("Spiritual Weapon")!.damage).toEqual([{ dice: "1d8", type: "force", role: "base", addMod: true }]);
    expect(spells.get("Delayed Blast Fireball")!.damage).toEqual([{ dice: "12d6", type: "fire", role: "base" }]);
  });

  it("the save is the one the spell forces, not an Advantage clause", () => {
    expect(spells.get("Conjure Animals")!.save).toBe("dex");
    expect(spells.get("Gaseous Form")!.save).toBeUndefined();
    expect(spells.get("Haste")!.save).toBeUndefined();
  });

  it("size limits are not areas of effect", () => {
    expect(spells.get("Minor Illusion")!.area).toBeUndefined();
    expect(spells.get("Druidcraft")!.area).toBeUndefined();
  });

  it("Eldritch Blast fires one beam below level 5", () => {
    expect(spells.get("Eldritch Blast")!.projectiles).toBe(1);
    expect(spellEffectAt(spells.get("Eldritch Blast")!, { casterLevel: 1 }).projectiles).toBe(1);
  });
});

describe("damage roles and multi-damage upcast (review round 1)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);
  const dice = (name: string, slotLevel: number) => spellEffectAt(spells.get(name)!, { slotLevel }).damage.map((d) => d.dice);

  it("Flame Strike at slot 6: Fire AND Radiant go to 6d6", () => {
    expect(spellEffectAt(spells.get("Flame Strike")!, { slotLevel: 6 }).damage).toEqual([
      { dice: "6d6", type: "fire", role: "base" },
      { dice: "6d6", type: "radiant", role: "base" },
    ]);
  });
  it("Ice Knife at slot 2: only the Cold damage increases", () => {
    expect(spellEffectAt(spells.get("Ice Knife")!, { slotLevel: 2 }).damage).toEqual([
      { dice: "1d10", type: "piercing", role: "base" },
      { dice: "3d6", type: "cold", role: "base" },
    ]);
  });
  it("Wall of Thorns at slot 7: both types increase; the slashing hit is a later trigger", () => {
    expect(dice("Wall of Thorns", 7)).toEqual(["8d8", "8d8"]);
    expect(spells.get("Wall of Thorns")!.damage.map((d) => d.role)).toEqual(["base", "later"]);
  });
  it("Wall of Ice and Arcane Hand give one increase per damage entry", () => {
    expect(dice("Wall of Ice", 7)).toEqual(["12d6", "6d6"]);
    expect(dice("Arcane Hand", 6)).toEqual(["7d8", "6d6"]);
    expect(spells.get("Arcane Hand")!.damage.map((d) => d.role)).toEqual(["base", "or"]);
  });
  it("Acid Arrow: initial and later acid both scale; Vitriolic Sphere: only the initial", () => {
    const acid = spellEffectAt(spells.get("Acid Arrow")!, { slotLevel: 3 });
    expect(acid.damage).toEqual([
      { dice: "5d4", type: "acid", role: "base" },
      { dice: "3d4", type: "acid", role: "later" },
    ]);
    expect(primaryDamage(acid).map((d) => d.dice)).toEqual(["5d4"]);
    expect(dice("Vitriolic Sphere", 5)).toEqual(["12d4", "5d4"]);
  });
  it("Spirit Guardians and Fire Shield are alternatives: one primary damage roll", () => {
    const sg = spells.get("Spirit Guardians")!;
    expect(sg.damage.map((d) => [d.type, d.role])).toEqual([["radiant", "base"], ["necrotic", "or"]]);
    expect(primaryDamage(sg)).toEqual([{ dice: "3d8", type: "radiant", role: "base" }]);
    expect(dice("Spirit Guardians", 4)).toEqual(["4d8", "4d8"]);
    expect(spells.get("Fire Shield")!.damage.map((d) => d.role)).toEqual(["base", "or"]);
  });
  it("Prismatic Spray: one ray per creature (first ray primary, the rest alternatives)", () => {
    const ps = spells.get("Prismatic Spray")!;
    expect(ps.damage[0]).toEqual({ dice: "12d6", type: "fire", role: "base" });
    expect(ps.damage.slice(1).every((d) => d.role === "or")).toBe(true);
    expect(primaryDamage(ps)).toHaveLength(1);
  });
  it("Ice Storm and Meteor Swarm deal both types together; Storm of Vengeance is staged", () => {
    expect(primaryDamage(spells.get("Ice Storm")!).map((d) => d.type)).toEqual(["bludgeoning", "cold"]);
    expect(primaryDamage(spells.get("Meteor Swarm")!)).toHaveLength(2);
    expect(spells.get("Storm of Vengeance")!.damage.map((d) => d.role)).toEqual(["base", "later", "later", "later", "later"]);
    expect(dice("Ice Storm", 5)).toEqual(["3d10", "4d6"]);
  });
});

describe("scaling math (review round 1)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);
  it("cantrip tiers at caster levels 4/5/10/11/16/17/20", () => {
    const fb = spells.get("Fire Bolt")!;
    const at = (l: number) => spellEffectAt(fb, { casterLevel: l }).damage[0].dice;
    expect([4, 5, 10, 11, 16, 17, 20].map(at)).toEqual(["1d10", "2d10", "2d10", "3d10", "3d10", "4d10", "4d10"]);
    const eb = spells.get("Eldritch Blast")!;
    expect([5, 11, 17].map((l) => spellEffectAt(eb, { casterLevel: l }).projectiles)).toEqual([2, 3, 4]);
  });
  it("slot 12 clamps to 9, a slot below the spell's level casts at its own level", () => {
    expect(spellEffectAt(spells.get("Fireball")!, { slotLevel: 12 })).toMatchObject({ castLevel: 9, damage: [{ dice: "14d6" }] });
    expect(spellEffectAt(spells.get("Fireball")!, { slotLevel: 1 })).toMatchObject({ castLevel: 3, damage: [{ dice: "8d6" }] });
    expect(spellEffectAt(spells.get("Fireball")!, {})).toMatchObject({ castLevel: 3, damage: [{ dice: "8d6" }] });
  });
  it("Heal 7 → 80; Disintegrate 7 → 13d6+40; Magic Missile 3 → 5 darts; Cure Wounds 2 → 4d8; Hold Person 4 → +2 targets", () => {
    expect(spellEffectAt(spells.get("Heal")!, { slotLevel: 7 }).heal?.dice).toBe("80");
    expect(spellEffectAt(spells.get("Disintegrate")!, { slotLevel: 7 }).damage[0].dice).toBe("13d6+40");
    expect(spellEffectAt(spells.get("Magic Missile")!, { slotLevel: 3 }).projectiles).toBe(5);
    expect(spellEffectAt(spells.get("Cure Wounds")!, { slotLevel: 2 }).heal?.dice).toBe("4d8");
    expect(spellEffectAt(spells.get("Hold Person")!, { slotLevel: 4 }).extraTargets).toBe(2);
  });
});

describe("SpellCatalog.find is strict (review round 1)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);

  it("normalised exact key: spaces, case, straight and curly apostrophes, slashes", () => {
    expect(spellKey("Hunter’s Mark")).toBe("huntersmark");
    expect(spells.find("fire ball")?.name).toBe("Fireball");
    expect(spells.find("hunters mark")?.name).toBe("Hunter's Mark");
    expect(spells.find("Hunter’s Mark")?.name).toBe("Hunter's Mark");
    expect(spells.find("Hunter's Mark")?.name).toBe("Hunter's Mark");
    expect(spells.find("enlarge reduce")?.name).toBe("Enlarge/Reduce");
    expect(spells.find("  CURE   wounds ")?.name).toBe("Cure Wounds");
  });
  it("a unique prefix resolves; an ambiguous one does not", () => {
    expect(spells.find("Disinteg")?.name).toBe("Disintegrate");
    expect(spells.find("Prismatic Spr")?.name).toBe("Prismatic Spray");
    expect(spells.find("Prismatic")).toBeUndefined();
    expect(spells.find("Fire")).toBeUndefined();
    expect(spells.find("Bolt")).toBeUndefined();
  });
  it("short queries never match", () => {
    expect(spells.find("a")).toBeUndefined();
    expect(spells.find("ab")).toBeUndefined();
    expect(spells.candidates("a")).toEqual([]);
  });
  it("misspellings resolve only when unique, within distance 1 (5–7 chars) or 2 (8+)", () => {
    expect(editDistance("magicmissle", "magicmissile")).toBe(1);
    expect(spells.find("Magic Missle")?.name).toBe("Magic Missile");
    expect(spells.find("Firebal")?.name).toBe("Fireball"); // unique prefix
    expect(spells.find("Fyreball")?.name).toBe("Fireball");
    expect(spells.find("Shild")?.name).toBe("Shield"); // 5 chars, distance 1
    expect(spells.find("Shiled")).toBeUndefined(); // 6 chars, distance 2 → too far
    expect(spells.find("Bles")?.name).toBe("Bless"); // unique prefix
    expect(spells.find("Blss")).toBeUndefined(); // distance 1 from Bless, but 4 chars → no fuzzy step
  });
  it("candidates offers 'did you mean' names", () => {
    expect(spells.candidates("Fire")).toEqual(expect.arrayContaining(["Fire Bolt", "Fireball", "Fire Shield"]));
    expect(spells.candidates("Fire").length).toBeLessThanOrEqual(5);
    expect(spells.candidates("Magic Missle")[0]).toBe("Magic Missile");
    expect(spells.candidates("zzzzzzzzzz")).toEqual([]);
  });
});

describe("damage parsing (review round 2)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);
  const dmg = (n: string) => spells.get(n)!.damage.map((d) => `${d.dice} ${d.type} ${d.role}`);

  it("type lists: '5d10 Radiant or Necrotic damage' and '5d8 Acid, Cold, Fire, Lightning, or Thunder damage'", () => {
    expect(dmg("Forbiddance")).toEqual(["5d10 radiant base", "5d10 necrotic or"]);
    expect(dmg("Glyph of Warding")).toEqual(["5d8 acid base", "5d8 cold or", "5d8 fire or", "5d8 lightning or", "5d8 thunder or"]);
    const glyph = spellEffectAt(spells.get("Glyph of Warding")!, { slotLevel: 5 });
    expect(glyph.damage.every((d) => d.dice === "7d8")).toBe(true);
    expect(primaryDamage(glyph)).toEqual([{ dice: "7d8", type: "acid", role: "base" }]);
  });
  it("equal dice+type at different places are separate hits (Searing Smite, Wall of Fire)", () => {
    expect(dmg("Searing Smite")).toEqual(["1d6 fire base", "1d6 fire later"]);
    expect(dmg("Wall of Fire")).toEqual(["5d8 fire base", "5d8 fire later"]);
    // "All the damage" / "The damage" increases apply to the later hit too
    expect(spellEffectAt(spells.get("Searing Smite")!, { slotLevel: 2 }).damage.map((d) => d.dice)).toEqual(["2d6", "2d6"]);
    expect(spellEffectAt(spells.get("Wall of Fire")!, { slotLevel: 5 }).damage.map((d) => d.dice)).toEqual(["6d8", "6d8"]);
  });
  it("untyped 'choice' damage takes every match (Conjure Elemental)", () => {
    expect(dmg("Conjure Elemental")).toEqual(["8d8 choice base", "4d8 choice later"]);
  });
  it("flat damage without dice (Guardian of Faith)", () => {
    expect(dmg("Guardian of Faith")).toEqual(["20 radiant base"]);
  });
  it("'or half as much' is not an alternative", () => {
    expect(primaryDamage(spells.get("Ice Storm")!).length).toBe(2);
  });
});

describe("areas (review round 2)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);
  it.each([
    ["Sunbeam", { shape: "line", sizeFt: 60, widthFt: 5 }],
    ["Sleet Storm", { shape: "cylinder", sizeFt: 20, heightFt: 40 }],
    ["Reverse Gravity", { shape: "cylinder", sizeFt: 50, heightFt: 100 }],
    ["Magic Circle", { shape: "cylinder", sizeFt: 10, heightFt: 20 }],
    ["Call Lightning", { shape: "cylinder", sizeFt: 60, heightFt: 10 }],
    ["Flame Strike", { shape: "cylinder", sizeFt: 10, heightFt: 40 }],
  ])("%s area", (name, area) => {
    expect(spells.get(name)!.area).toEqual(area);
  });
});

describe("lookup aliases and fuzzy limits (review round 2)", () => {
  const spells = new SpellCatalog();
  spells.load(SRD_DIR);

  it("every alias target exists in the SRD", () => {
    expect(Object.keys(spells.aliasTargets()).sort()).toEqual(Object.keys(SPELL_ALIASES).sort());
    for (const target of Object.values(SPELL_ALIASES)) expect(spells.get(target)?.name, target).toBe(target);
  });
  it.each([
    ["Melf's acid arrow", "Acid Arrow"],
    ["Tasha's hideous laughter", "Hideous Laughter"],
    ["Bigby's hand", "Arcane Hand"],
    ["Bigby’s grasping hand", "Arcane Hand"],
    ["Mordenkainen's sword", "Arcane Sword"],
    ["Mordenkainen's magnificent mansion", "Magnificent Mansion"],
    ["Otiluke's resilient sphere", "Resilient Sphere"],
    ["Leomund's tiny hut", "Tiny Hut"],
    ["Evard's black tentacles", "Black Tentacles"],
    ["Nystul's magic aura", "Arcanist's Magic Aura"],
    ["Otto's irresistible dance", "Irresistible Dance"],
    ["cure light wounds", "Cure Wounds"],
    ["the shield spell", "Shield"],
    ["Zorbo's fireball", "Fireball"], // unknown possessive is stripped as a fallback
  ])("find(%s) → %s", (q, want) => {
    expect(spells.find(q)?.name).toBe(want);
  });
  it("the possessive fallback still respects strictness", () => {
    expect(spells.find("Zorbo's fire")).toBeUndefined();
    expect(spells.find("Hunter's Mark")?.name).toBe("Hunter's Mark"); // real possessive name wins first
  });
  it("candidates include alias targets", () => {
    expect(spells.candidates("Bigby's hand")).toContain("Arcane Hand");
    expect(spells.candidates("Bigby's")).toContain("Arcane Hand");
  });
  it("fuzzy distance: 1 for 5–7 characters, 2 for 8+; never below 5; only when unique", () => {
    expect(fuzzyDistanceFor(4)).toBe(0);
    expect(fuzzyDistanceFor(5)).toBe(1);
    expect(fuzzyDistanceFor(7)).toBe(1);
    expect(fuzzyDistanceFor(8)).toBe(2);
    expect(spells.find("links")).toBeUndefined(); // distance 2 from Blink, 5 chars
    expect(spells.find("Blnk")).toBeUndefined(); // 4 chars: no fuzzy step even at distance 1
    expect(spells.find("Haam")).toBeUndefined(); // 4 chars
    expect(spells.find("Fireboll")).toBeUndefined(); // distance 1 from both Fire Bolt and Fireball
    expect(spells.find("Fyreboll")).toBeUndefined(); // distance 2 from both
    expect(spells.find("Fireboltt")?.name).toBe("Fire Bolt");
  });
});
