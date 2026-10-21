import { describe, expect, it } from "vitest";
import { GameState, MapFeature } from "@dm/shared";
import * as mod from "./mapObjects";

/** Pure planning for loot markers, interactable auras and the pick-up toast (V3). */

type Obj = { id: string; locationId: string; kind: "loot" | "interactable"; name: string; x: number; y: number; items: never[]; gold: number; iconUrl?: string; discovered: boolean; used: boolean; hidden: boolean };
type Aura = { key: string; x: number; y: number; w: number; h: number };
const { auraPlan, lootMarkers, pickupToastText } = mod as unknown as {
  auraPlan: (s: unknown, features: unknown[]) => Aura[];
  lootMarkers: (s: unknown) => Array<{ id: string; x: number; y: number; iconUrl?: string }>;
  pickupToastText: (p: { characterId: string; characterName: string; items: Array<{ name: string; qty: number; iconUrl?: string }>; gold: number }) => string;
};

const obj = (o: Partial<Obj>): Obj => ({ id: "o", locationId: "loc", kind: "loot", name: "Loot", x: 1, y: 1, items: [], gold: 0, discovered: true, used: false, hidden: false, ...o });

function state(objs: Obj[]) {
  const s = GameState.parse({ campaignId: "c", locationId: "loc", fog: { loc: { enabled: true, revealed: ["1,1", "2,1", "3,3", "4,4"] } } });
  (s as unknown as { mapObjects: Obj[] }).mapObjects = objs;
  return s;
}

describe("lootMarkers", () => {
  it("returns shown loot objects only", () => {
    const s = state([
      obj({ id: "l1", x: 1, y: 1, iconUrl: "/media/c/item_sack.png" }),
      obj({ id: "l2", x: 2, y: 1 }),
      obj({ id: "l_fog", x: 9, y: 9 }),
      obj({ id: "l_hidden", x: 1, y: 1, hidden: true }),
      obj({ id: "l_other", x: 1, y: 1, locationId: "loc_b" }),
      obj({ id: "i1", kind: "interactable", x: 3, y: 3 }),
    ]);
    expect(lootMarkers(s)).toEqual([
      { id: "l1", x: 1, y: 1, iconUrl: "/media/c/item_sack.png" },
      { id: "l2", x: 2, y: 1 },
    ]);
  });
});

describe("auraPlan", () => {
  it("draws auras on shown interactables (1x1, hidden once used) and shown interactive features", () => {
    const s = state([
      obj({ id: "i1", kind: "interactable", x: 3, y: 3 }),
      obj({ id: "i2", kind: "interactable", x: 4, y: 4, used: true }),
      obj({ id: "i_hidden", kind: "interactable", x: 1, y: 1, hidden: true }),
      obj({ id: "i_fog", kind: "interactable", x: 9, y: 9 }),
      obj({ id: "l1", x: 1, y: 1 }),
    ]);
    const features = [
      MapFeature.parse({ name: "lever", interactive: true, x: 2, y: 1, w: 2, h: 1 }),
      MapFeature.parse({ name: "pews", x: 1, y: 1 }),
      MapFeature.parse({ name: "far chest", interactive: true, x: 8, y: 8 }),
    ];
    const plan = auraPlan(s, features);
    const strip = plan.map(({ x, y, w, h }) => ({ x, y, w, h }));
    expect(strip).toHaveLength(2);
    expect(strip).toEqual(
      expect.arrayContaining([
        { x: 3, y: 3, w: 1, h: 1 },
        { x: 2, y: 1, w: 2, h: 1 },
      ]),
    );
    expect(plan.some((a) => a.key === "obj:i2")).toBe(false);
    expect(new Set(plan.map((a) => a.key)).size).toBe(2);
  });

  it("is empty without objects or interactive features", () => {
    expect(auraPlan(state([]), [])).toEqual([]);
  });
});

describe("pickupToastText", () => {
  it("names the character, the items with quantities and the gold", () => {
    expect(pickupToastText({ characterId: "pc", characterName: "Sylvaine", items: [{ name: "Dagger", qty: 2 }], gold: 15 })).toBe("Sylvaine picks up Dagger x2, 15 gp");
    expect(pickupToastText({ characterId: "pc", characterName: "Sylvaine", items: [{ name: "Gem", qty: 1 }], gold: 0 })).toBe("Sylvaine picks up Gem");
    expect(pickupToastText({ characterId: "pc", characterName: "Thorin", items: [], gold: 7 })).toBe("Thorin picks up 7 gp");
  });
});
