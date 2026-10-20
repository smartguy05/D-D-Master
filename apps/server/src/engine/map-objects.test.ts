import { describe, expect, it } from "vitest";
import { Character, Item, emptyGameState, type GameState, type Location } from "@dm/shared";
import * as engine from "./tools.js";
import { executeEngineTool, isEngineTool, partyStatus, type EngineContext } from "./tools.js";

/** Loot drops, pick-ups and interactables (Phase 3). The tools are new, so names are passed loosely. */

type Obj = {
  id: string;
  locationId: string;
  kind: "loot" | "interactable";
  name: string;
  x: number;
  y: number;
  items: Array<{ id: string; name: string; qty: number; description?: string; iconUrl?: string }>;
  gold: number;
  iconUrl?: string;
  discovered: boolean;
  used: boolean;
  hidden: boolean;
};
type Outcome = { output: any; lootDropped?: string[]; pickups?: Array<{ characterId: string; characterName: string; items: Array<{ name: string; qty: number; iconUrl?: string }>; gold: number }> };

const vault: Location = { id: "loc_vault", name: "Vault", description: "", mapPrompt: "", fog: false, gridW: 12, gridH: 10, walls: [], features: [] } as Location;
const cellar: Location = { ...vault, id: "loc_cellar", name: "Cellar" } as Location;

function ctx(): EngineContext {
  return { rng: () => 10, monsterTemplate: () => undefined, spell: () => undefined, spellCandidates: () => [], classData: () => undefined, locations: [vault, cellar] };
}

const run = (s: GameState, name: string, args: unknown) => executeEngineTool(s, name as never, args, ctx()) as unknown as { state: GameState; outcome: Outcome };
const objects = (s: GameState) => ((s as unknown as { mapObjects?: Obj[] }).mapObjects ?? []) as Obj[];

function scene(): GameState {
  let s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, gold: 3 }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Sylvaine", maxHp: 8, hp: 8, inventory: [Item.parse({ id: "item_old", name: "Dagger", qty: 1 })] }),
  );
  s = executeEngineTool(s, "change_scene", { location_id: "loc_vault" }, ctx()).state;
  s = executeEngineTool(s, "spawn_monster", { name: "Goblin", x: 6, y: 4 }, ctx()).state;
  return s;
}
const goblin = (s: GameState) => s.monsters[0]!;

/** An engine error: thrown, or returned as {error}; either way the map objects did not change. */
function expectError(s: GameState, name: string, args: unknown, msg?: RegExp) {
  const snapshot = structuredClone(s);
  let thrown: unknown;
  let res: ReturnType<typeof run> | undefined;
  try {
    res = run(s, name, args);
  } catch (e) {
    thrown = e;
  }
  expect(s).toEqual(snapshot); // input untouched
  if (thrown) {
    if (msg) expect(String((thrown as Error).message)).toMatch(msg);
    return;
  }
  expect(res!.outcome.output?.error).toBeDefined();
  if (msg) expect(String(res!.outcome.output.error)).toMatch(msg);
  expect(objects(res!.state)).toEqual(objects(s));
}

function dropAt(s: GameState, args: Record<string, unknown>) {
  const r = run(s, "drop_loot", args);
  return { ...r, obj: objects(r.state).find((o) => o.id === r.outcome.output.object_id)! };
}

describe("map object tools are engine tools (T2)", () => {
  it("lists all five", () => {
    for (const n of ["drop_loot", "pick_up", "place_interactable", "set_interactable", "remove_map_object"]) {
      expect(isEngineTool(n)).toBe(true);
      expect((engine.ENGINE_TOOLS as readonly string[]).includes(n)).toBe(true);
    }
  });

  it("never mutates the input state", () => {
    const s = scene();
    const snapshot = structuredClone(s);
    const a = run(s, "drop_loot", { monster_id: goblin(s).id, items: [{ name: "Dagger" }], gold: 4 });
    expect(s).toEqual(snapshot);
    const id = a.outcome.output.object_id as string;
    const before = structuredClone(a.state);
    run(a.state, "pick_up", { object_id: id, character_id: "pc_a" });
    run(a.state, "set_interactable", { id, hidden: true });
    run(a.state, "remove_map_object", { id });
    run(a.state, "place_interactable", { name: "Lever", x: 1, y: 1 });
    expect(a.state).toEqual(before);
  });
});

describe("drop_loot (D1-D3)", () => {
  it("drops loot on a monster's cell with fresh item ids, a default name, a log line and lootDropped", () => {
    const s = scene();
    const g = goblin(s);
    const logs = s.log.length;
    const { state, outcome, obj } = dropAt(s, { monster_id: g.id, items: [{ name: "Dagger", qty: 2, description: "rusty" }, { name: "Copper ring" }], gold: 15 });
    expect(objects(state)).toHaveLength(1);
    expect(obj).toMatchObject({ kind: "loot", locationId: "loc_vault", x: 6, y: 4, gold: 15, discovered: true, hidden: false, used: false, name: `${g.name}'s loot` });
    expect(obj.items).toHaveLength(2);
    expect(obj.items[0]).toMatchObject({ name: "Dagger", qty: 2, description: "rusty" });
    expect(obj.items[1]).toMatchObject({ name: "Copper ring", qty: 1 });
    expect(obj.items[0]!.id).toMatch(/^\w+_[0-9a-f]+$/);
    expect(obj.items[0]!.id).not.toBe(obj.items[1]!.id);
    expect(outcome.output).toMatchObject({ object_id: obj.id, name: obj.name, pos: [6, 4], gold: 15 });
    expect(JSON.stringify(outcome.output.items)).toContain("Dagger x2");
    expect(JSON.stringify(outcome.output.items)).toContain("Copper ring");
    expect(state.log.length).toBeGreaterThan(logs);
    expect(state.log.at(-1)!.kind).toBe("system");
    expect(outcome.lootDropped).toEqual([obj.id]);
  });

  it("works for a dead monster (its token stays until remove_monster) and takes a given name", () => {
    const s = scene();
    goblin(s).conditions.push("Dead");
    goblin(s).hp = 0;
    const { obj } = dropAt(s, { monster_id: goblin(s).id, gold: 3, name: "Bloody purse" });
    expect(obj).toMatchObject({ x: 6, y: 4, gold: 3, name: "Bloody purse" });
  });

  it("drops at x,y with the default name 'Loot'; x,y win over monster_id", () => {
    const s = scene();
    const a = dropAt(s, { x: 2, y: 3, items: [{ name: "Gem" }] });
    expect(a.obj).toMatchObject({ x: 2, y: 3, name: "Loot", kind: "loot", locationId: "loc_vault" });
    const b = dropAt(s, { monster_id: goblin(s).id, x: 1, y: 1, gold: 2 });
    expect(b.obj).toMatchObject({ x: 1, y: 1 });
  });

  it("other tools report lootDropped as []", () => {
    const s = scene();
    const r = run(s, "move_token", { entity_id: "pc_a", x: 2, y: 2 });
    expect(r.outcome.lootDropped).toEqual([]);
  });

  it("refuses bad drops without changing the state", () => {
    const s = scene();
    expectError(s, "drop_loot", { gold: 5 }); // neither monster_id nor x,y
    expectError(s, "drop_loot", { x: 2, gold: 5 }); // only x
    expectError(s, "drop_loot", { monster_id: "m_nope", gold: 5 }, /x/);
    const noToken = structuredClone(s);
    noToken.tokens = noToken.tokens.filter((t) => t.entityId !== goblin(s).id);
    expectError(noToken, "drop_loot", { monster_id: goblin(s).id, gold: 5 }, /x/);
    const nowhere = structuredClone(s);
    nowhere.locationId = undefined;
    expectError(nowhere, "drop_loot", { x: 1, y: 1, gold: 5 });
    expectError(s, "drop_loot", { x: 12, y: 1, gold: 5 }); // gridW 12: x 0..11
    expectError(s, "drop_loot", { x: 1, y: 10, gold: 5 });
    expectError(s, "drop_loot", { x: 1, y: 1 }, /nothing/i);
    expectError(s, "drop_loot", { x: 1, y: 1, items: [], gold: 0 }, /nothing/i);
  });
});

describe("pick_up (P1-P3)", () => {
  function withLoot() {
    const s = scene();
    const { state, obj } = dropAt(s, { monster_id: goblin(s).id, items: [{ name: "Dagger", qty: 2, description: "rusty" }, { name: "Silver key" }], gold: 15 });
    // Icons drawn later by the service.
    const o = objects(state).find((x) => x.id === obj.id)!;
    o.items[0]!.iconUrl = "/media/c1/item_dagger.png";
    o.items[1]!.iconUrl = "/media/c1/item_key.png";
    return { state, id: obj.id };
  }
  const char = (s: GameState, id: string) => s.characters.find((c) => c.id === id)!;

  it("takes everything by default: items merge like give_item, gold is added, the empty loot is removed", () => {
    const { state, id } = withLoot();
    const { state: next, outcome } = run(state, "pick_up", { object_id: id, character_id: "pc_b" });
    const syl = char(next, "pc_b");
    const dagger = syl.inventory.filter((i) => i.name === "Dagger");
    expect(dagger).toHaveLength(1);
    expect(dagger[0]).toMatchObject({ id: "item_old", qty: 3, iconUrl: "/media/c1/item_dagger.png" }); // existing entry gains the icon
    const key = syl.inventory.find((i) => i.name === "Silver key")!;
    expect(key).toMatchObject({ qty: 1, iconUrl: "/media/c1/item_key.png" });
    expect(key.id).toMatch(/^\w+_/);
    expect(key.id).not.toBe(objects(state)[0]!.items[1]!.id); // a new inventory id
    expect(syl.gold).toBe(15);
    expect(objects(next)).toEqual([]);
    expect(outcome.output).toMatchObject({ character: "Sylvaine", gold: 15, removed: true, remaining: { items: [], gold: 0 } });
    expect(JSON.stringify(outcome.output.taken)).toContain("Dagger x2");
    expect(JSON.stringify(outcome.output.taken)).toContain("Silver key");
    expect(JSON.stringify(outcome.output.inventory)).toContain("Dagger");
    expect(outcome.pickups).toEqual([
      {
        characterId: "pc_b",
        characterName: "Sylvaine",
        items: [
          { name: "Dagger", qty: 2, iconUrl: "/media/c1/item_dagger.png" },
          { name: "Silver key", qty: 1, iconUrl: "/media/c1/item_key.png" },
        ],
        gold: 15,
      },
    ]);
  });

  it("a new item keeps the loot's description", () => {
    const { state, id } = withLoot();
    const { state: next } = run(state, "pick_up", { object_id: id, character_id: "pc_a" });
    expect(char(next, "pc_a").inventory.find((i) => i.name === "Dagger")).toMatchObject({ qty: 2, description: "rusty", iconUrl: "/media/c1/item_dagger.png" });
    expect(char(next, "pc_a").gold).toBe(18);
  });

  it("takes only the named items (case-insensitive, full qty) and no gold unless asked", () => {
    const { state, id } = withLoot();
    const { state: next, outcome } = run(state, "pick_up", { object_id: id, character_id: "pc_a", items: ["dagger"] });
    expect(char(next, "pc_a").inventory.find((i) => i.name === "Dagger")?.qty).toBe(2);
    expect(char(next, "pc_a").gold).toBe(3);
    const left = objects(next).find((o) => o.id === id)!;
    expect(left.items.map((i) => i.name)).toEqual(["Silver key"]);
    expect(left.gold).toBe(15);
    expect(outcome.output).toMatchObject({ gold: 0, removed: false });
    expect(outcome.output.remaining.gold).toBe(15);
    expect(JSON.stringify(outcome.output.remaining.items)).toContain("Silver key");
    expect(outcome.pickups).toEqual([{ characterId: "pc_a", characterName: "Thorin", items: [{ name: "Dagger", qty: 2, iconUrl: "/media/c1/item_dagger.png" }], gold: 0 }]);
  });

  it("gold:true with items:[] takes only the gold", () => {
    const { state, id } = withLoot();
    const { state: next, outcome } = run(state, "pick_up", { object_id: id, character_id: "pc_a", items: [], gold: true });
    expect(char(next, "pc_a").gold).toBe(18);
    expect(char(next, "pc_a").inventory).toEqual([]);
    const left = objects(next).find((o) => o.id === id)!;
    expect(left.gold).toBe(0);
    expect(left.items).toHaveLength(2);
    expect(outcome.output).toMatchObject({ gold: 15, removed: false });
  });

  it("does not check the character's distance to the loot", () => {
    const { state, id } = withLoot();
    const far = run(state, "move_token", { entity_id: "pc_a", x: 0, y: 0 }).state;
    expect(() => run(far, "pick_up", { object_id: id, character_id: "pc_a" })).not.toThrow();
    expect(run(far, "pick_up", { object_id: id, character_id: "pc_a" }).outcome.output.error).toBeUndefined();
  });

  it("refuses unknown objects, other locations, non-characters and missing items", () => {
    const { state, id } = withLoot();
    expectError(state, "pick_up", { object_id: "obj_nope", character_id: "pc_a" });
    const elsewhere = structuredClone(state);
    objects(elsewhere)[0]!.locationId = "loc_cellar";
    expectError(elsewhere, "pick_up", { object_id: id, character_id: "pc_a" });
    expectError(state, "pick_up", { object_id: id, character_id: goblin(state).id });
    expectError(state, "pick_up", { object_id: id, character_id: "pc_zzz" });
    expectError(state, "pick_up", { object_id: id, character_id: "pc_a", items: ["Longsword"] }, /Dagger/);
  });

  it("taking the items out of an interactable never removes it", () => {
    let s = scene();
    const placed = run(s, "place_interactable", { name: "Chest", x: 3, y: 3 });
    s = placed.state;
    const chestId = placed.outcome.output.object_id as string;
    objects(s).find((o) => o.id === chestId)!.items.push({ id: "item_c1", name: "Potion of Healing", qty: 1 });
    objects(s).find((o) => o.id === chestId)!.gold = 4;
    const { state: next, outcome } = run(s, "pick_up", { object_id: chestId, character_id: "pc_a" });
    expect(char(next, "pc_a").inventory.find((i) => i.name === "Potion of Healing")).toBeDefined();
    const chest = objects(next).find((o) => o.id === chestId)!;
    expect(chest).toMatchObject({ kind: "interactable", items: [], gold: 0 });
    expect(outcome.output.removed).toBe(false);
  });

  it("refuses an empty take (nothing named, no gold) without changing the state or reporting a pickup", () => {
    // Bug pick-up-takes-nothing: a lever, or items:[] without gold, used to log "takes nothing" and toast.
    let s = scene();
    const placed = run(s, "place_interactable", { name: "Rusty lever", x: 3, y: 3 });
    s = placed.state;
    const leverId = placed.outcome.output.object_id as string;
    expectError(s, "pick_up", { object_id: leverId, character_id: "pc_a" }, /nothing to take/i);
    const { state, id } = withLoot();
    expectError(state, "pick_up", { object_id: id, character_id: "pc_a", items: [] }, /nothing to take.*Dagger/i);
    expectError(state, "pick_up", { object_id: id, character_id: "pc_a", items: [], gold: false });
  });

  it("trims item names on drop, so a padded name can be taken by name and merges with the same item", () => {
    // Bug loot-item-names-untrimmed.
    const s = scene();
    const { state, obj } = dropAt(s, { x: 2, y: 2, items: [{ name: "  Dagger " }] });
    expect(obj.items[0]!.name).toBe("Dagger");
    const { state: next, outcome } = run(state, "pick_up", { object_id: obj.id, character_id: "pc_b", items: ["dagger "] });
    expect(outcome.output.error).toBeUndefined();
    expect(char(next, "pc_b").inventory.filter((i) => i.name.trim() === "Dagger")).toHaveLength(1);
    expect(char(next, "pc_b").inventory.find((i) => i.name === "Dagger")!.qty).toBe(2);
    // An untrimmed name already in a saved state still matches and merges.
    const old = structuredClone(state);
    objects(old)[0]!.items[0]!.name = "Dagger ";
    const r = run(old, "pick_up", { object_id: obj.id, character_id: "pc_b", items: ["Dagger"] });
    expect(r.outcome.output.error).toBeUndefined();
    expect(char(r.state, "pc_b").inventory.filter((i) => i.name.trim() === "Dagger")).toHaveLength(1);
  });

  it("other tools report pickups as []", () => {
    const r = run(scene(), "move_token", { entity_id: "pc_a", x: 2, y: 2 });
    expect(r.outcome.pickups).toEqual([]);
  });
});

describe("interactables (I1, I2)", () => {
  it("place_interactable creates an interactable at the current location", () => {
    const s = scene();
    const { state, outcome } = run(s, "place_interactable", { name: "Sluice lever", x: 9, y: 2 });
    const o = objects(state).find((x) => x.id === outcome.output.object_id)!;
    expect(o).toMatchObject({ kind: "interactable", locationId: "loc_vault", name: "Sluice lever", x: 9, y: 2, hidden: false, items: [], gold: 0, used: false });
    expect(outcome.output).toEqual({ object_id: o.id, name: "Sluice lever", pos: [9, 2], hidden: false });
    const hidden = run(s, "place_interactable", { name: "Secret latch", x: 1, y: 1, hidden: true });
    expect(hidden.outcome.output.hidden).toBe(true);
    expect(objects(hidden.state)[0]!.hidden).toBe(true);
  });

  it("place_interactable needs a current location and a cell on the grid", () => {
    const s = scene();
    const nowhere = structuredClone(s);
    nowhere.locationId = undefined;
    expectError(nowhere, "place_interactable", { name: "Lever", x: 1, y: 1 });
    expectError(s, "place_interactable", { name: "Lever", x: 12, y: 1 });
    expectError(s, "place_interactable", { name: "Lever", x: 1, y: 10 });
  });

  it("set_interactable changes only the given fields, on loot too", () => {
    let s = scene();
    const placed = run(s, "place_interactable", { name: "Lever", x: 9, y: 2 });
    s = placed.state;
    const id = placed.outcome.output.object_id as string;
    const used = run(s, "set_interactable", { id, used: true });
    expect(objects(used.state)[0]).toMatchObject({ used: true, hidden: false, name: "Lever" });
    expect(used.outcome.output).toMatchObject({ name: "Lever" });
    expect(JSON.stringify(used.outcome.output)).toContain(id);
    const renamed = run(used.state, "set_interactable", { id, name: "Broken lever", hidden: true });
    expect(objects(renamed.state)[0]).toMatchObject({ used: true, hidden: true, name: "Broken lever" });

    const loot = dropAt(s, { x: 4, y: 4, gold: 2 });
    const hid = run(loot.state, "set_interactable", { id: loot.obj.id, hidden: true });
    expect(objects(hid.state).find((o) => o.id === loot.obj.id)!.hidden).toBe(true);
  });

  it("set_interactable without changes is a no-op; an unknown id errors", () => {
    let s = scene();
    const placed = run(s, "place_interactable", { name: "Lever", x: 9, y: 2 });
    s = placed.state;
    const id = placed.outcome.output.object_id as string;
    const same = run(s, "set_interactable", { id });
    expect(objects(same.state)).toEqual(objects(s));
    const again = run(s, "set_interactable", { id, used: false, hidden: false, name: "Lever" });
    expect(objects(again.state)).toEqual(objects(s));
    expectError(s, "set_interactable", { id: "obj_nope", used: true });
  });

  it("remove_map_object removes loot or interactables; an unknown id errors", () => {
    let s = scene();
    const placed = run(s, "place_interactable", { name: "Lever", x: 9, y: 2 });
    const loot = dropAt(placed.state, { x: 4, y: 4, gold: 2 });
    s = loot.state;
    expect(objects(s)).toHaveLength(2);
    const a = run(s, "remove_map_object", { id: placed.outcome.output.object_id });
    expect(objects(a.state).map((o) => o.id)).toEqual([loot.obj.id]);
    const b = run(a.state, "remove_map_object", { id: loot.obj.id });
    expect(objects(b.state)).toEqual([]);
    expectError(s, "remove_map_object", { id: "obj_nope" });
  });
});

describe("get_party_status map_objects (G1)", () => {
  it("lists the current location's objects compactly and omits other locations", () => {
    let s = scene();
    s = dropAt(s, { x: 4, y: 4, items: [{ name: "Dagger", qty: 2 }, { name: "Gem" }], gold: 0 }).state;
    s = dropAt(s, { x: 5, y: 5, gold: 9 }).state;
    const lever = run(s, "place_interactable", { name: "Lever", x: 9, y: 2, hidden: true });
    s = run(lever.state, "set_interactable", { id: lever.outcome.output.object_id, used: true }).state;
    (s as unknown as { mapObjects: Obj[] }).mapObjects.push({ id: "obj_far", locationId: "loc_cellar", kind: "loot", name: "Far loot", x: 1, y: 1, items: [], gold: 1, discovered: true, used: false, hidden: false });

    const status = partyStatus(s, ctx()) as unknown as { map_objects?: Array<Record<string, unknown>> };
    const list = status.map_objects!;
    expect(list).toHaveLength(3);
    expect(list.some((o) => o.id === "obj_far")).toBe(false);
    const daggers = list.find((o) => o.name === "Loot" && (o.items as string[]).length === 2)!;
    expect(daggers).toMatchObject({ kind: "loot", pos: [4, 4], items: ["Dagger x2", "Gem"] });
    expect(daggers.gold).toBeUndefined();
    expect(daggers.hidden).toBeUndefined();
    expect(daggers.used).toBeUndefined();
    const gold = list.find((o) => o.gold === 9)!;
    expect(gold).toMatchObject({ kind: "loot", pos: [5, 5] });
    const lv = list.find((o) => o.name === "Lever")!;
    expect(lv).toMatchObject({ kind: "interactable", pos: [9, 2], hidden: true, used: true });
    expect(typeof lv.id).toBe("string");
  });

  it("is omitted when the current location has none", () => {
    const s = scene();
    expect((partyStatus(s, ctx()) as unknown as { map_objects?: unknown }).map_objects).toBeUndefined();
  });
});
