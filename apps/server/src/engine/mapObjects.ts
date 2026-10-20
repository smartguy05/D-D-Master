import type { GameState, Item, Location, MapObject, ToolArgsOf } from "@dm/shared";
import { newId } from "./ids.js";
import { addLog, addToInventory, requireCharacter, sameItemName, tokenFor } from "./state.js";
import type { EngineOutcome } from "./tools.js";

/**
 * Loot drops, pick-ups and interactables (state.mapObjects). Handlers mutate the cloned state they
 * are given (see executeEngineTool) and throw on a bad call, so the caller's state never changes.
 */

interface MapCtx {
  locations: Location[];
}

/** "Dagger x2" / "Gem": how items read for the DM. */
export function itemLabel(i: Pick<Item, "name" | "qty">): string {
  return i.qty > 1 ? `${i.name} x${i.qty}` : i.name;
}

function currentLocation(state: GameState, ctx: MapCtx): Location {
  const loc = state.locationId ? ctx.locations.find((l) => l.id === state.locationId) : undefined;
  if (!loc) throw new Error("No current location: change_scene first.");
  return loc;
}

function requireOnGrid(loc: Location, x: number, y: number) {
  if (x < 0 || y < 0 || x >= loc.gridW || y >= loc.gridH)
    throw new Error(`Cell (${x}, ${y}) is off the ${loc.name} grid (x 0-${loc.gridW - 1}, y 0-${loc.gridH - 1}).`);
}

function requireObject(state: GameState, id: string): MapObject {
  state.mapObjects ??= [];
  const o = state.mapObjects.find((m) => m.id === id);
  if (!o) {
    const here = state.mapObjects.filter((m) => m.locationId === state.locationId).map((m) => `${m.id} (${m.name})`);
    throw new Error(`No map object "${id}". Here: ${here.length ? here.join(", ") : "none"}.`);
  }
  return o;
}

function summary(o: MapObject) {
  return { object_id: o.id, kind: o.kind, name: o.name, pos: [o.x, o.y], items: o.items.map(itemLabel), gold: o.gold, used: o.used, hidden: o.hidden };
}

export function dropLoot(state: GameState, a: ToolArgsOf<"drop_loot">, ctx: MapCtx, out: EngineOutcome) {
  if (a.items.length === 0 && a.gold === 0) throw new Error("Nothing to drop: give items or gold.");
  const loc = currentLocation(state, ctx);
  const monster = a.monster_id ? state.monsters.find((m) => m.id === a.monster_id) : undefined;
  let x: number;
  let y: number;
  if (a.x !== undefined && a.y !== undefined) {
    x = a.x;
    y = a.y;
  } else if (a.monster_id) {
    const t = monster ? tokenFor(state, monster.id) : undefined;
    if (!monster) throw new Error(`No monster "${a.monster_id}". Pass x and y to drop the loot on a cell.`);
    if (!t || t.x < 0 || t.y < 0) throw new Error(`${monster.name} has no token on the map. Pass x and y to drop the loot on a cell.`);
    x = t.x;
    y = t.y;
  } else {
    throw new Error("Give monster_id (a monster on the map) or both x and y.");
  }
  requireOnGrid(loc, x, y);
  const obj: MapObject = {
    id: newId("obj"),
    locationId: loc.id,
    kind: "loot",
    name: a.name?.trim() || (monster ? `${monster.name}'s loot` : "Loot"),
    x,
    y,
    items: a.items.map((i) => ({ id: newId("item"), name: i.name.trim(), qty: i.qty, ...(i.description ? { description: i.description } : {}) })),
    gold: a.gold,
    discovered: true,
    used: false,
    hidden: false,
  };
  state.mapObjects ??= [];
  state.mapObjects.push(obj);
  out.lootDropped.push(obj.id);
  const contents = [...obj.items.map(itemLabel), ...(obj.gold ? [`${obj.gold} gp`] : [])].join(", ");
  addLog(state, { kind: "system", text: `${obj.name} lies at (${x}, ${y}): ${contents}` });
  return { object_id: obj.id, name: obj.name, pos: [x, y], items: obj.items.map(itemLabel), gold: obj.gold };
}

export function pickUp(state: GameState, a: ToolArgsOf<"pick_up">, _ctx: MapCtx, out: EngineOutcome) {
  const obj = requireObject(state, a.object_id);
  if (obj.locationId !== state.locationId) throw new Error(`${obj.name} (${obj.id}) is not at the current location.`);
  const c = requireCharacter(state, a.character_id);
  let take: Item[];
  if (a.items === undefined) take = [...obj.items];
  else {
    take = [];
    for (const name of a.items) {
      const item = obj.items.find((i) => sameItemName(i.name, name));
      if (!item) {
        const there = obj.items.map(itemLabel);
        throw new Error(`${obj.name} has no "${name}". It holds: ${there.length ? there.join(", ") : "no items"}${obj.gold ? `, ${obj.gold} gp` : ""}.`);
      }
      if (!take.includes(item)) take.push(item);
    }
  }
  const takeGold = a.gold ?? a.items === undefined;
  const gold = takeGold ? obj.gold : 0;
  if (take.length === 0 && gold === 0) {
    const there = [...obj.items.map(itemLabel), ...(obj.gold ? [`${obj.gold} gp`] : [])];
    throw new Error(`Nothing to take from ${obj.name}: it holds ${there.length ? there.join(", ") : "nothing"}.${there.length ? " Name items, or pass gold: true." : ""}`);
  }
  for (const item of take) addToInventory(c, item);
  obj.items = obj.items.filter((i) => !take.includes(i));
  obj.gold -= gold;
  c.gold += gold;
  const removed = obj.kind === "loot" && obj.items.length === 0 && obj.gold === 0;
  if (removed) state.mapObjects = state.mapObjects.filter((m) => m !== obj);
  const taken = take.map(itemLabel);
  out.pickups.push({
    characterId: c.id,
    characterName: c.name,
    items: take.map((i) => ({ name: i.name, qty: i.qty, ...(i.iconUrl ? { iconUrl: i.iconUrl } : {}) })),
    gold,
  });
  const got = [...taken, ...(gold ? [`${gold} gp`] : [])];
  addLog(state, { kind: "system", text: `${c.name} takes ${got.length ? got.join(", ") : "nothing"} from ${obj.name}` });
  return {
    character: c.name,
    taken,
    gold,
    remaining: { items: obj.items.map(itemLabel), gold: obj.gold },
    removed,
    inventory: c.inventory.map((i) => `${i.name} x${i.qty}`),
  };
}

export function placeInteractable(state: GameState, a: ToolArgsOf<"place_interactable">, ctx: MapCtx) {
  const loc = currentLocation(state, ctx);
  requireOnGrid(loc, a.x, a.y);
  const obj: MapObject = { id: newId("obj"), locationId: loc.id, kind: "interactable", name: a.name.trim(), x: a.x, y: a.y, items: [], gold: 0, discovered: true, used: false, hidden: a.hidden };
  state.mapObjects ??= [];
  state.mapObjects.push(obj);
  addLog(state, { kind: "system", text: `${obj.name} placed at (${a.x}, ${a.y})${a.hidden ? " (hidden)" : ""}` });
  return { object_id: obj.id, name: obj.name, pos: [obj.x, obj.y], hidden: obj.hidden };
}

export function setInteractable(state: GameState, a: ToolArgsOf<"set_interactable">) {
  const obj = requireObject(state, a.id);
  if (a.used !== undefined) obj.used = a.used;
  if (a.hidden !== undefined) obj.hidden = a.hidden;
  if (a.name !== undefined) obj.name = a.name.trim();
  return summary(obj);
}

export function removeMapObject(state: GameState, a: ToolArgsOf<"remove_map_object">) {
  const obj = requireObject(state, a.id);
  state.mapObjects = state.mapObjects.filter((m) => m !== obj);
  addLog(state, { kind: "system", text: `${obj.name} removed from the map` });
  return { removed: obj.id, name: obj.name };
}

/** get_party_status: the current location's objects, compact (undefined when there are none). */
export function mapObjectsStatus(state: GameState) {
  const here = (state.mapObjects ?? []).filter((o) => o.locationId === state.locationId);
  if (!here.length) return undefined;
  return here.map((o) => ({
    id: o.id,
    kind: o.kind,
    name: o.name,
    pos: [o.x, o.y],
    items: o.items.map(itemLabel),
    gold: o.gold || undefined,
    hidden: o.hidden || undefined,
    used: o.used || undefined,
  }));
}
