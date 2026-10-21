import { describe, expect, it } from "vitest";
import { Character, Location, Monster, emptyGameState } from "@dm/shared";
import { playerMapPlan, viewWindow } from "./playerMap";

const LOCS = [Location.parse({ id: "loc_hall", name: "Hall", gridW: 6, gridH: 4, mapUrl: "/hall.png" }), Location.parse({ id: "loc_mill", name: "Old Mill", gridW: 4, gridH: 4 })];

/** Thorin in the focused Hall with a hidden goblin; Bram at the Old Mill (fogged) with a wolf. */
function split() {
  const s = emptyGameState("c1");
  s.locationId = "loc_hall";
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 10, color: "#123456" }),
    Character.parse({ id: "pc_c", playerName: "Kim", name: "Bram", maxHp: 10, hp: 10 }),
  );
  s.tokens = [
    { id: "t1", entityId: "pc_a", entityType: "character", x: 1, y: 1, size: 1 },
    { id: "t2", entityId: "mon_gob", entityType: "monster", x: 4, y: 2, size: 1 },
  ];
  s.monsters = [Monster.parse({ id: "mon_gob", name: "Goblin", maxHp: 7, hp: 7, hidden: true })];
  s.scenes.loc_mill = {
    tokens: [
      { id: "t3", entityId: "pc_c", entityType: "character", x: 0, y: 1, size: 1 },
      { id: "t4", entityId: "mon_wolf", entityType: "monster", x: 1, y: 1, size: 1 },
      { id: "t5", entityId: "mon_owl", entityType: "monster", x: 3, y: 2, size: 1 },
    ],
    monsters: [Monster.parse({ id: "mon_wolf", name: "Wolf", maxHp: 11, hp: 11 }), Monster.parse({ id: "mon_owl", name: "Owl", maxHp: 1, hp: 1 })],
    combat: { active: false, round: 0, turnIndex: 0, order: [], turn: null, reactionsUsed: [], announced: [] },
  };
  s.partyLocations = { pc_c: "loc_mill" };
  s.fog.loc_mill = { enabled: true, revealed: ["0,1", "1,1"], hidden: [] };
  return s;
}

describe("the phone's map", () => {
  it("shows the player's own location in focus, without hidden monsters, own token marked", () => {
    const plan = playerMapPlan(split(), LOCS, "pc_a")!;
    expect(plan).toMatchObject({ locationId: "loc_hall", gridW: 6, gridH: 4, mapUrl: "/hall.png", fog: null, me: { x: 1, y: 1 } });
    expect(plan.tokens).toEqual([{ id: "t1", entityId: "pc_a", x: 1, y: 1, name: "Thorin", color: "#123456", me: true, monster: false }]);
  });

  it("shows an away player's parked scene with its fog: unseen monsters are left out", () => {
    const plan = playerMapPlan(split(), LOCS, "pc_c")!;
    expect(plan.locationId).toBe("loc_mill");
    expect(plan.tokens.map((t) => t.name)).toEqual(["Bram", "Wolf"]);
    expect(plan.fog).toHaveLength(4 * 4 - 2);
    expect(plan.me).toEqual({ x: 0, y: 1 });
  });

  it("nothing before the first scene", () => {
    const s = emptyGameState("c1");
    s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 10 }));
    expect(playerMapPlan(s, LOCS, "pc_a")).toBeUndefined();
  });

  it("zooms to a window around the player's token, kept on the grid", () => {
    expect(viewWindow({ gridW: 40, gridH: 30, me: { x: 20, y: 15 } }, true)).toEqual({ x: 14, y: 9, w: 12, h: 12 });
    expect(viewWindow({ gridW: 40, gridH: 30, me: { x: 1, y: 29 } }, true)).toEqual({ x: 0, y: 18, w: 12, h: 12 });
    expect(viewWindow({ gridW: 8, gridH: 6, me: { x: 1, y: 1 } }, true)).toEqual({ x: 0, y: 0, w: 8, h: 6 });
    expect(viewWindow({ gridW: 40, gridH: 30, me: { x: 20, y: 15 } }, false)).toEqual({ x: 0, y: 0, w: 40, h: 30 });
    expect(viewWindow({ gridW: 40, gridH: 30 }, true)).toEqual({ x: 0, y: 0, w: 40, h: 30 });
  });
});
