import { describe, expect, it } from "vitest";
import { attackStyle, damageTypeOf, elementFor, findAttack } from "./effects.js";
import { BoardEffect } from "./schemas.js";

describe("attackStyle", () => {
  it("uses an explicit hint first", () => {
    expect(attackStyle({ hint: "ranged", name: "Longsword" })).toBe("ranged");
    expect(attackStyle({ hint: "spell", name: "Longsword" })).toBe("spell");
  });

  it("reads the SRD Melee/Ranged Attack Roll text", () => {
    expect(attackStyle({ name: "Claw", description: "Melee Attack Roll: +4, reach 5 ft." })).toBe("melee");
    expect(attackStyle({ name: "Spit", description: "Ranged Attack Roll: +3, range 30 ft." })).toBe("ranged");
  });

  it("falls back to weapon keywords", () => {
    for (const n of ["Shortbow", "Light Crossbow", "Sling", "Dart", "Blowgun", "Net", "Longbow +1", "Javelin", "Javelin (thrown)", "Throwing hand axe"])
      expect(attackStyle({ name: n }), n).toBe("ranged");
    for (const n of ["Scimitar", "Greataxe", "Bite", "Unarmed Strike", "Spear", "Bowie knife"]) expect(attackStyle({ name: n }), n).toBe("melee");
  });

  it("Melee or Ranged text uses the name: thrown is ranged, else melee", () => {
    expect(attackStyle({ name: "Dagger", description: "Melee or Ranged Attack Roll: +4" })).toBe("melee");
    expect(attackStyle({ name: "Dagger (thrown)", description: "Melee or Ranged Attack Roll: +4" })).toBe("ranged");
  });

  it("a spell is a spell", () => {
    expect(attackStyle({ name: "Fire Bolt", isSpell: true })).toBe("spell");
  });
});

describe("elementFor", () => {
  it("maps damage types to elements", () => {
    expect(elementFor("Fire")).toBe("fire");
    expect(elementFor("cold")).toBe("cold");
    expect(elementFor("lightning")).toBe("lightning");
    expect(elementFor("thunder")).toBe("thunder");
    expect(elementFor("acid")).toBe("acid");
    expect(elementFor("poison")).toBe("poison");
    expect(elementFor("radiant")).toBe("radiant");
    expect(elementFor("necrotic")).toBe("necrotic");
    expect(elementFor("force")).toBe("force");
    expect(elementFor("psychic")).toBe("psychic");
    expect(elementFor("slashing")).toBe("physical");
    expect(elementFor("piercing")).toBe("physical");
    expect(elementFor(undefined)).toBe("physical");
    expect(elementFor("1d6+2 fire")).toBe("fire");
  });
});

describe("damageTypeOf / findAttack", () => {
  it("reads the damage type from an attack's damage text", () => {
    expect(damageTypeOf("1d6+2 slashing")).toBe("slashing");
    expect(damageTypeOf("2d6 fire")).toBe("fire");
    expect(damageTypeOf("1d8+3")).toBeUndefined();
  });

  it("finds an attack by attack_name, else by a label that names it", () => {
    const attacks = [{ name: "Scimitar" }, { name: "Shortbow" }];
    expect(findAttack(attacks, "shortbow")?.name).toBe("Shortbow");
    expect(findAttack(attacks, undefined, "Goblin scimitar attack")?.name).toBe("Scimitar");
    expect(findAttack(attacks, undefined, "Stealth check")).toBeUndefined();
    expect(findAttack(attacks, "Bow")?.name).toBe("Shortbow");
  });
});

describe("BoardEffect schema", () => {
  it("parses an old effect without the new fields", () => {
    const e = BoardEffect.parse({ id: "fx_1", kind: "hit", targetId: "pc_a", ts: 1 });
    expect(e.style).toBeUndefined();
    expect(e.outcome).toBeUndefined();
  });

  it("accepts attack and area effects with style, outcome, label and count", () => {
    const e = BoardEffect.parse({ id: "fx_2", kind: "attack", style: "ranged", outcome: "crit", label: "Shortbow", count: 3, ts: 1 });
    expect(e.kind).toBe("attack");
    expect(BoardEffect.parse({ id: "fx_3", kind: "area", style: "area", radius: 4, shape: "sphere", ts: 1 }).shape).toBe("sphere");
  });
});

describe("attackStyle name keywords (review round 1)", () => {
  it("a melee 'Elbow' strike is not a bow", () => {
    expect(attackStyle({ name: "Elbow Strike" })).toBe("melee");
  });
});

describe("attackStyle: damage type and distance (review round 1)", () => {
  it("a ranged attack with a magical damage type is a spell (no wooden arrow)", () => {
    expect(attackStyle({ name: "Necrotic Ray", description: "Ranged Attack Roll", damageType: "necrotic" })).toBe("spell");
    expect(attackStyle({ name: "Longbow", description: "Ranged Attack Roll", damageType: "piercing" })).toBe("ranged");
    expect(attackStyle({ name: "Claw", description: "Melee Attack Roll", damageType: "necrotic" })).toBe("melee");
  });

  it("Melee or Ranged uses the distance when known: adjacent (1 cell, diagonals too) is melee, else ranged", () => {
    const d = { name: "Javelin", description: "Melee or Ranged Attack Roll: +4" };
    expect(attackStyle({ ...d, distance: 1 })).toBe("melee");
    expect(attackStyle({ ...d, distance: Math.SQRT2 })).toBe("melee");
    expect(attackStyle({ ...d, distance: 3 })).toBe("ranged");
    expect(attackStyle({ name: "Dagger", description: "Melee or Ranged Attack Roll: +4", distance: 4 })).toBe("ranged");
    // without a distance the name decides
    expect(attackStyle(d)).toBe("ranged");
  });

  it("bow words: shortbow, longbow, crossbow, bows; not elbow or rainbow", () => {
    for (const n of ["Shortbow", "Longbow", "Heavy Crossbow", "Bow", "bows"]) expect(attackStyle({ name: n }), n).toBe("ranged");
    for (const n of ["Elbow Strike", "Rainbow Fist", "Bowie knife"]) expect(attackStyle({ name: n }), n).toBe("melee");
  });
});
