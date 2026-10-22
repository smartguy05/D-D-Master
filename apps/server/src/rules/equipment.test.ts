import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { EquipmentCatalog, parseEquipmentOptions } from "./equipment.js";

const SRD_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../data/srd");

describe("parseEquipmentOptions", () => {
  it("splits A/B packages, counts, singular names and gold", () => {
    expect(parseEquipmentOptions("Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's Pack, and 15 GP; or (B) 75 GP")).toEqual([
      { letter: "A", items: [{ name: "Greataxe", qty: 1 }, { name: "Handaxe", qty: 4 }, { name: "Explorer's Pack", qty: 1 }], gold: 15 },
      { letter: "B", items: [], gold: 75 },
    ]);
  });

  it("keeps parenthesised details and plurals it can't safely singularise", () => {
    const [a] = parseEquipmentOptions("_Choose A or B:_ (A) Calligrapher's Supplies, Book (prayers), Holy Symbol, Parchment (10 sheets), Robe, 2 Pouches, 20 Arrows, 8 GP; or (B) 50 GP");
    expect(a.items).toEqual([
      { name: "Calligrapher's Supplies", qty: 1 },
      { name: "Book (prayers)", qty: 1 },
      { name: "Holy Symbol", qty: 1 },
      { name: "Parchment (10 sheets)", qty: 1 },
      { name: "Robe", qty: 1 },
      { name: "Pouch", qty: 2 },
      { name: "Arrows", qty: 20 },
    ]);
    expect(a.gold).toBe(8);
  });
});

describe("EquipmentCatalog (real SRD data)", () => {
  const eq = new EquipmentCatalog();
  eq.load(SRD_DIR);

  it("armor: base AC, DEX cap and category; the shield", () => {
    expect(eq.armor("Leather Armor")).toEqual({ name: "Leather Armor", category: "light", base: 11 });
    expect(eq.armor("chain shirt")).toEqual({ name: "Chain Shirt", category: "medium", base: 13, dexCap: 2 });
    expect(eq.armor("Chain Mail")).toEqual({ name: "Chain Mail", category: "heavy", base: 16, dexCap: 0 });
    expect(eq.armor("Shield")).toEqual({ name: "Shield", category: "shield", base: 2 });
    expect(eq.armorNames()).toHaveLength(13);
  });

  it("weapons: dice, damage type, category, ranged and finesse", () => {
    expect(eq.weapon("Dagger")).toMatchObject({ category: "simple", ranged: false, dice: "1d4", damageType: "Piercing", finesse: true });
    expect(eq.weapon("Longbow")).toMatchObject({ category: "martial", ranged: true, dice: "1d8" });
    expect(eq.weapon("greatsword")).toMatchObject({ dice: "2d6", damageType: "Slashing", finesse: false });
    expect(eq.weapon("Rope")).toBeUndefined();
    expect(eq.weaponNames().length).toBeGreaterThan(30);
  });
});
