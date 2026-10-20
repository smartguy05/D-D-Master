import { describe, expect, it } from "vitest";
import * as shared from "./index.js";
import * as schemas from "./schemas.js";
import { GameState, Item, MapFeature, emptyGameState } from "./schemas.js";

type Parser = { parse(x: unknown): any; safeParse(x: unknown): { success: boolean } };
const MapObject = (schemas as unknown as { MapObject: Parser }).MapObject;

describe("MapObject schema (S1)", () => {
  it("is exported from schemas and the package index", () => {
    expect(MapObject).toBeDefined();
    expect((shared as Record<string, unknown>).MapObject).toBe(MapObject);
  });

  it("fills defaults for a minimal loot object", () => {
    const o = MapObject.parse({ id: "obj_1", locationId: "loc_a", kind: "loot", name: "Goblin's loot", x: 3, y: 4 });
    expect(o).toMatchObject({ id: "obj_1", locationId: "loc_a", kind: "loot", name: "Goblin's loot", x: 3, y: 4, items: [], gold: 0, discovered: true, used: false, hidden: false });
    expect(o.iconUrl).toBeUndefined();
  });

  it("accepts interactables, items and an icon; rejects bad kinds and cells", () => {
    const o = MapObject.parse({
      id: "obj_2",
      locationId: "loc_a",
      kind: "interactable",
      name: "Lever",
      x: 0,
      y: 0,
      items: [{ id: "item_1", name: "Key", qty: 1, iconUrl: "/media/c/item_a.png" }],
      gold: 5,
      iconUrl: "/media/c/item_sack.png",
      hidden: true,
      used: true,
      discovered: false,
    });
    expect(o).toMatchObject({ kind: "interactable", gold: 5, hidden: true, used: true, discovered: false, iconUrl: "/media/c/item_sack.png" });
    expect(o.items[0]).toMatchObject({ name: "Key", iconUrl: "/media/c/item_a.png" });
    expect(MapObject.safeParse({ id: "o", locationId: "l", kind: "chest", name: "n", x: 0, y: 0 }).success).toBe(false);
    expect(MapObject.safeParse({ id: "o", locationId: "l", kind: "loot", name: "n", x: -1, y: 0 }).success).toBe(false);
    expect(MapObject.safeParse({ id: "o", locationId: "l", kind: "loot", name: "n", x: 1.5, y: 0 }).success).toBe(false);
    expect(MapObject.safeParse({ id: "o", locationId: "l", kind: "loot", name: "n", x: 0, y: 0, gold: -1 }).success).toBe(false);
  });
});

describe("GameState.mapObjects, Item.iconUrl, MapFeature.interactive (S2)", () => {
  it("emptyGameState has no map objects", () => {
    expect((emptyGameState("c") as unknown as { mapObjects: unknown }).mapObjects).toEqual([]);
  });

  it("Item takes an optional iconUrl", () => {
    expect(Item.parse({ id: "i", name: "Dagger" }).iconUrl).toBeUndefined();
    expect(Item.parse({ id: "i", name: "Dagger", iconUrl: "/media/c/item_x.png" }).iconUrl).toBe("/media/c/item_x.png");
  });

  it("MapFeature.interactive defaults to false", () => {
    expect((MapFeature.parse({ name: "lever", x: 1, y: 1 }) as { interactive?: boolean }).interactive).toBe(false);
    expect((MapFeature.parse({ name: "lever", x: 1, y: 1, interactive: true }) as { interactive?: boolean }).interactive).toBe(true);
  });

  it("an old save without the new fields still parses", () => {
    const old = {
      campaignId: "c_old",
      locationId: "loc_a",
      characters: [{ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, inventory: [{ id: "item_1", name: "Torch", qty: 2 }] }],
      featureEdits: { loc_a: { mapUrl: "/m/1.png", features: [{ name: "lever", kind: "feature", lit: false, blocks: true, x: 4, y: 3, w: 1, h: 1 }] } },
    };
    const s = GameState.parse(JSON.parse(JSON.stringify(old)));
    expect((s as unknown as { mapObjects: unknown }).mapObjects).toEqual([]);
    expect((s.featureEdits.loc_a!.features[0] as { interactive?: boolean }).interactive).toBe(false);
    expect(s.characters[0]!.inventory[0]!.iconUrl).toBeUndefined();
    expect(s.characters[0]!.inventory[0]!.name).toBe("Torch");
  });

  it("keeps saved map objects", () => {
    const s = GameState.parse({ campaignId: "c", mapObjects: [{ id: "obj_1", locationId: "loc_a", kind: "loot", name: "Loot", x: 1, y: 2, gold: 7 }] });
    expect((s as unknown as { mapObjects: Array<{ gold: number; items: unknown[] }> }).mapObjects[0]).toMatchObject({ gold: 7, items: [] });
  });
});
