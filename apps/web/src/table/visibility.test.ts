import { describe, expect, it } from "vitest";
import { GameState, Monster, type BoardEffect, type RollResult } from "@dm/shared";
import { monsterShownOnTable, effectForTable, rollForTable } from "./visibility";

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

  it("shows an ally travelling with the party even in fog, unless hidden", () => {
    const s = state();
    s.monsters.push(Monster.parse({ id: "m_ally", name: "Mara", maxHp: 9, hp: 9, npc: true, ally: true, follows: true }));
    s.monsters.push(Monster.parse({ id: "m_stay", name: "Innkeeper", maxHp: 4, hp: 4, npc: true, ally: true }));
    s.tokens.push({ id: "t5", entityId: "m_ally", entityType: "monster", x: 8, y: 8, size: 1 });
    s.tokens.push({ id: "t6", entityId: "m_stay", entityType: "monster", x: 7, y: 8, size: 1 });
    expect(monsterShownOnTable(s)("m_ally")).toBe(true);
    expect(monsterShownOnTable(s)("m_stay")).toBe(false);
    s.monsters.find((m) => m.id === "m_ally")!.hidden = true;
    expect(monsterShownOnTable(s)("m_ally")).toBe(false);
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

const roll = (r: Partial<RollResult>): RollResult => ({
  id: "r",
  notation: "1d20+4",
  label: "Goblin 2 scimitar attack",
  rollerName: "Goblin 2",
  dice: [{ sides: 20, value: 12 }],
  modifier: 4,
  total: 16,
  physical: false,
  secret: false,
  ts: 0,
  ...r,
}) as RollResult;

describe("rollForTable", () => {
  it("shows a hidden or fogged monster's roll as an anonymous DM roll", () => {
    const s = state();
    for (const id of ["m_hid", "m_fog"]) {
      const r = rollForTable(roll({ rollerId: id }), s);
      expect(r).toMatchObject({ rollerName: "DM", label: "", rollerId: undefined, total: 16, notation: "1d20+4" });
    }
  });

  it("leaves visible monsters, characters and DM rolls alone", () => {
    const s = state();
    const vis = roll({ rollerId: "m_vis", rollerName: "Goblin 1", label: "Goblin 1 attack" });
    expect(rollForTable(vis, s)).toBe(vis);
    const pc = roll({ rollerId: "pc", rollerName: "Thorin", label: "Stealth" });
    expect(rollForTable(pc, s)).toBe(pc);
    const dm = roll({ rollerName: "DM", label: "Random encounter" });
    expect(rollForTable(dm, s)).toBe(dm);
    expect(rollForTable(vis, null)).toBe(vis);
  });
});
