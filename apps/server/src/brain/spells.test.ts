import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SpellCatalog } from "../rules/spells.js";
import { normalizeSpellList } from "./spells.js";

const SRD = ["Bless", "Cure Wounds", "Guiding Bolt", "Sacred Flame", "Guidance", "Light", "Shield", "Magic Missile", "Mage Hand"];
/** A stand-in for the SRD spell catalog: case-insensitive exact names, canonical casing out. */
const isSpell = (name: string) => SRD.find((s) => s.toLowerCase() === name.trim().toLowerCase());

describe("normalizeSpellList", () => {
  it("turns prose spellcasting blocks into canonical SRD spell names, in first-seen order", () => {
    expect(
      normalizeSpellList(
        [
          "Spellcasting: Wisdom; spell save DC 13; +5 to hit",
          "Prepared level-1 cleric spells: Bless, Cure Wounds, Guiding Bolt",
          "Cantrips: Sacred Flame, Guidance and Light",
          "bless",
        ],
        isSpell,
      ),
    ).toEqual(["Bless", "Cure Wounds", "Guiding Bolt", "Sacred Flame", "Guidance", "Light"]);
  });

  it("keeps a clean list as is, canonicalising the casing", () => {
    expect(normalizeSpellList(["magic missile", "Shield", "MAGE HAND"], isSpell)).toEqual(["Magic Missile", "Shield", "Mage Hand"]);
  });

  it("strips parenthetical notes and dedupes case-insensitively", () => {
    expect(normalizeSpellList(["Shield (reaction)", "shield", "Magic Missile (1st level)"], isSpell)).toEqual(["Shield", "Magic Missile"]);
  });

  it("drops entries that are not SRD spells when some entries are", () => {
    expect(normalizeSpellList(["Bless", "Moonbeam Lance", "Spellcasting: Wisdom"], isSpell)).toEqual(["Bless"]);
  });

  it("keeps clean-looking non-SRD names when nothing matched (homebrew spells)", () => {
    expect(normalizeSpellList(["Moonbeam Lance", "Shadow Step"], isSpell)).toEqual(["Moonbeam Lance", "Shadow Step"]);
  });

  it("the homebrew fallback still drops prose (colons, digits, long sentences)", () => {
    expect(normalizeSpellList(["Moonbeam Lance", "Spellcasting: Wisdom", "spell save DC 13", "I pray to the sea every morning"], isSpell)).toEqual([
      "Moonbeam Lance",
    ]);
    expect(normalizeSpellList(["Spellcasting: Wisdom; spell save DC 13"], isSpell)).toEqual([]);
  });

  it("an empty list stays empty", () => {
    expect(normalizeSpellList([], isSpell)).toEqual([]);
  });
});

describe("normalizeSpellList with the real SRD catalog (adversarial review)", () => {
  const catalog = new SpellCatalog();
  catalog.load(join(fileURLToPath(new URL(".", import.meta.url)), "../../../../data/srd"));
  const srd = (name: string) => catalog.get(name)?.name;

  it("keeps SRD spells whose names contain 'and' (Protection from Evil and Good, Purify Food and Drink…)", () => {
    expect(
      normalizeSpellList(["Bless", "Protection from Evil and Good", "Purify Food and Drink", "Detect Poison and Disease", "Create Food and Water"], srd),
    ).toEqual(["Bless", "Protection from Evil and Good", "Purify Food and Drink", "Detect Poison and Disease", "Create Food and Water"]);
  });

  it("an 'and'-named spell inside a prose line survives too", () => {
    expect(normalizeSpellList(["1st level: Bless, Protection from Evil and Good"], srd)).toEqual(["Bless", "Protection from Evil and Good"]);
  });
});

describe("normalizeSpellList: import options and notes", () => {
  const SRD2 = ["Bless", "Cure Wounds", "Detect Magic"];
  const known = (n: string) => SRD2.find((s) => s.toLowerCase() === n.trim().toLowerCase());

  it("keepHomebrew (sheet imports) keeps name-like non-SRD spells next to SRD ones, never prose", () => {
    expect(normalizeSpellList(["Bless", "Moonbeam Lance", "Spellcasting: Wisdom"], known, { keepHomebrew: true })).toEqual(["Bless", "Moonbeam Lance"]);
  });

  it("keepHomebrew keeps a homebrew name sharing an entry with an SRD spell", () => {
    expect(normalizeSpellList(["Bless, Eldritch Smite Plus"], known, { keepHomebrew: true })).toEqual(["Bless", "Eldritch Smite Plus"]);
    expect(normalizeSpellList(["Bless, Eldritch Smite Plus"], known)).toEqual(["Bless"]);
  });

  it("strips 'x2' counts and '[R]' ritual tags", () => {
    expect(normalizeSpellList(["Cure Wounds x2", "Detect Magic [R]"], known)).toEqual(["Cure Wounds", "Detect Magic"]);
  });
});
