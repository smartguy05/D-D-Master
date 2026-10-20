import { describe, expect, it } from "vitest";
import { MapObject } from "@dm/shared";
import { objectContents, objectSummary } from "./objects";

const base = { id: "o1", locationId: "loc", name: "Goblin's loot", x: 3, y: 4 };

describe("host map object labels", () => {
  it("lists items with quantities and gold", () => {
    const o = MapObject.parse({ ...base, kind: "loot", gold: 15, items: [{ id: "i1", name: "Dagger", qty: 2 }, { id: "i2", name: "Gem", qty: 1 }] });
    expect(objectContents(o)).toEqual(["Dagger x2", "Gem", "15 gp"]);
    expect(objectSummary(o)).toBe("Goblin's loot (loot) at 3,4: Dagger x2, Gem, 15 gp");
  });

  it("tags hidden and used, and leaves out empty contents", () => {
    const o = MapObject.parse({ ...base, name: "Lever", kind: "interactable", hidden: true, used: true });
    expect(objectContents(o)).toEqual([]);
    expect(objectSummary(o)).toBe("Lever (interactable) at 3,4 · hidden, used");
  });
});
