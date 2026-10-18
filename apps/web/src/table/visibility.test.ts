import { describe, expect, it } from "vitest";
import { GameState, Monster, type BoardEffect } from "@dm/shared";
import { monsterShownOnTable, effectForTable } from "./visibility";

function state() {
  return GameState.parse({
    campaignId: "c",
    locationId: "loc",
    monsters: [
      Monster.parse({ id: "m_vis", name: "Goblin 1", maxHp: 7, hp: 7 }),
      Monster.parse({ id: "m_hid", name: "Goblin 2", maxHp: 7, hp: 7, hidden: true }),
      Monster.parse({ id: "m_fog", name: "Goblin 3", maxHp: 7, hp: 7 }),
    ],
    tokens: [
      { id: "t1", entityId: "m_vis", entityType: "monster", x: 1, y: 1 },
      { id: "t2", entityId: "m_hid", entityType: "monster", x: 1, y: 2 },
      { id: "t3", entityId: "m_fog", entityType: "monster", x: 9, y: 9 },
      { id: "t4", entityId: "pc", entityType: "character", x: 2, y: 1 },
    ],
    fog: { loc: { enabled: true, revealed: ["1,1", "1,2", "2,1"] } },
  });
}

const fx = (e: Partial<BoardEffect>): BoardEffect => ({ id: "e", kind: "hit", ts: 0, ...e });

describe("table visibility", () => {
  it("hides host-hidden monsters and monsters in fog; characters and unknown ids show", () => {
    const shown = monsterShownOnTable(state());
    expect(shown("m_vis")).toBe(true);
    expect(shown("m_hid")).toBe(false);
    expect(shown("m_fog")).toBe(false);
    expect(shown("pc")).toBe(true);
  });

  it("drops effects on a hidden monster and hides a hidden attacker's origin", () => {
    const s = state();
    expect(effectForTable(s, fx({ targetId: "m_hid" }))).toBeNull();
    expect(effectForTable(s, fx({ targetId: "m_fog" }))).toBeNull();
    expect(effectForTable(s, fx({ targetId: "pc", sourceId: "m_hid" }))).toEqual(fx({ targetId: "pc", sourceId: undefined }));
    expect(effectForTable(s, fx({ targetId: "pc", sourceId: "m_vis" }))).toEqual(fx({ targetId: "pc", sourceId: "m_vis" }));
    expect(effectForTable(s, fx({ x: 3, y: 3 }))).toEqual(fx({ x: 3, y: 3 }));
  });
});
