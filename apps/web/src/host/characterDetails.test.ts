import { describe, expect, it } from "vitest";
import { Character } from "@dm/shared";
import { detailSections, isRowToggle, NO_TOGGLE, toggleOpen } from "./characterDetails";

const base = () => Character.parse({ id: "c1", playerName: "Ann", name: "Mira", maxHp: 10, hp: 10 });

describe("host character details", () => {
  it("keeps one row open: opening another closes the first, clicking the open one closes it", () => {
    expect(toggleOpen(null, "a")).toBe("a");
    expect(toggleOpen("a", "b")).toBe("b");
    expect(toggleOpen("b", "b")).toBeNull();
  });

  it("clicks inside buttons and the portrait do not toggle the row", () => {
    const inside = (hit: boolean) => ({ closest: (sel: string) => (sel === NO_TOGGLE && hit ? {} : null) });
    expect(isRowToggle(inside(false))).toBe(true);
    expect(isRowToggle(inside(true))).toBe(false);
    expect(isRowToggle(null)).toBe(true);
    expect(isRowToggle({})).toBe(true);
  });

  it("hides empty sections", () => {
    expect(detailSections(base())).toEqual({ attacks: false, rules: false, spells: false, features: false, about: false });
  });

  it("shows sections that have something in them", () => {
    const c = Character.parse({
      ...base(),
      attacks: [{ name: "Longsword", toHit: 5, damage: "1d8+3" }],
      spellSlots: [{ level: 1, max: 2, used: 0 }],
      spells: ["Shield"],
      features: ["Second Wind"],
      backstory: "Raised by wolves.",
    });
    expect(detailSections(c)).toEqual({ attacks: true, rules: true, spells: true, features: true, about: true });
    expect(detailSections({ ...base(), hitDice: { die: 8, max: 1, used: 0 } } as Character).rules).toBe(true);
    expect(detailSections({ ...base(), appearance: "  " }).about).toBe(false);
  });
});
