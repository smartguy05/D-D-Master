import { describe, expect, it } from "vitest";
import { Character, GameState, Monster, emptyGameState, exitNear, nextLocation, type Location, type MapFeature } from "@dm/shared";
import { executeEngineTool, type EngineContext } from "./tools.js";

const feature = (f: Partial<MapFeature> & Pick<MapFeature, "name" | "x" | "y" | "w" | "h">): MapFeature =>
  ({ kind: "feature", lit: false, blocks: false, interactive: false, ...f }) as MapFeature;

const mill: Location = {
  id: "loc_mill",
  name: "The Old Mill",
  description: "",
  mapPrompt: "",
  fog: true,
  walls: [],
  gridW: 20,
  gridH: 14,
  features: [
    feature({ name: "Lit doorway (east)", kind: "entrance", x: 16, y: 7, w: 4, h: 7 }),
    feature({ name: "Crooked rug (cellar hatch)", kind: "focal", x: 12, y: 5, w: 5, h: 5 }),
    feature({ name: "Mill wheel", blocks: true, interactive: true, x: 0, y: 2, w: 4, h: 6 }),
    feature({ name: "Cellar passage (west arch)", kind: "exit", x: 1, y: 9, w: 4, h: 5 }),
  ],
};
const graves: Location = { id: "loc_graves", name: "The Giggling Graveyard", description: "", mapPrompt: "", fog: true, walls: [], features: [], gridW: 24, gridH: 16 };

function ctx(): EngineContext {
  return {
    rng: () => 10,
    monsterTemplate: () => undefined,
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [mill, graves],
  };
}

function party(): GameState {
  let s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Brannoc", maxHp: 12, hp: 12 }),
    Character.parse({ id: "pc_b", playerName: "Alex", name: "Pippa", maxHp: 8, hp: 8 }),
    Character.parse({ id: "pc_c", playerName: "Jo", name: "Elowen", maxHp: 8, hp: 8 }),
  );
  s.monsters.push(Monster.parse({ id: "mon_w", name: "Wisp", maxHp: 4, hp: 4, ac: 10, npc: true, ally: true, follows: true }));
  return executeEngineTool(s, "change_scene", { location_id: "loc_mill" }, ctx()).state;
}

const run = (s: GameState, args: unknown) => executeEngineTool(s, "move_party", args, ctx());
const posOf = (s: GameState, id: string) => s.tokens.find((t) => t.entityId === id)!;
const near = (s: GameState, id: string, x: number, y: number, r: number) => {
  const t = posOf(s, id);
  return Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= r;
};

describe("move_party", () => {
  it("walks every present PC and follower to a named feature, each on its own cell", () => {
    const { state, outcome } = run(party(), { to: "rug" });
    const out = outcome.output as { to: string; moved: { name: string }[] };
    expect(out.to).toBe("Crooked rug (cellar hatch)");
    expect(out.moved.map((m) => m.name).sort()).toEqual(["Brannoc", "Elowen", "Pippa", "Wisp"]);
    for (const id of ["pc_a", "pc_b", "pc_c", "mon_w"]) expect(near(state, id, 14, 7, 2)).toBe(true);
    const cells = state.tokens.map((t) => `${t.x},${t.y}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("clears the fog around where the party ends up", () => {
    let s = party();
    expect(s.fog.loc_mill.revealed).not.toContain("2,4");
    s = run(s, { to: "Mill wheel" }).state;
    expect(s.fog.loc_mill.revealed).toContain("2,4"); // inside the wheel's box, next to them
    expect(s.tokens.every((t) => !(t.x < 4 && t.y >= 2 && t.y < 8))).toBe(true); // nobody on the blocking wheel
  });

  it("moves only character_ids when given", () => {
    const before = party();
    const s = run(before, { x: 8, y: 2, character_ids: ["pc_b"] }).state;
    expect(near(s, "pc_b", 8, 2, 0)).toBe(true);
    expect(posOf(s, "pc_a")).toEqual(posOf(before, "pc_a"));
  });

  it("at an exit, hints the next location so the DM calls change_scene", () => {
    const out = run(party(), { to: "cellar passage" }).outcome.output as { hint?: string };
    expect(out.hint).toMatch(/change_scene loc_graves/);
    expect(out.hint).toMatch(/Giggling Graveyard/);
  });

  it("move_token onto an exit carries the same hint", () => {
    const out = executeEngineTool(party(), "move_token", { entity_id: "pc_a", x: 2, y: 10 }, ctx()).outcome.output as { hint?: string };
    expect(out.hint).toMatch(/loc_graves/);
  });

  it("is refused in combat and throws on an unknown feature", () => {
    const s = party();
    s.combat.active = true;
    expect((run(s, { to: "rug" }).outcome.output as { error?: string }).error).toMatch(/move_token/);
    expect(() => run(party(), { to: "bell tower" })).toThrow(/Features here/);
    expect(() => run(party(), {})).toThrow(/to/);
  });
});

describe("exit helpers", () => {
  it("exitNear finds an exit the cell is on or beside", () => {
    expect(exitNear(mill.features, 5, 9)?.name).toBe("Cellar passage (west arch)");
    expect(exitNear(mill.features, 10, 2)).toBeUndefined();
  });

  it("nextLocation follows the outline order", () => {
    expect(nextLocation([mill, graves], "loc_mill")?.id).toBe("loc_graves");
    expect(nextLocation([mill, graves], "loc_graves")).toBeUndefined();
  });
});
