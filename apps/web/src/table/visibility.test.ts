import { describe, expect, it } from "vitest";
import { GameState, Monster, visibleCells, type BoardEffect, type RollResult } from "@dm/shared";
import { monsterShownOnTable, effectForTable, rollForTable } from "./visibility";
import * as visibility from "./visibility";

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

describe("monsters behind walls (F3)", () => {
  // The fog's revealed set comes from line of sight (shared visibleCells); visibility.ts itself is
  // unchanged: a monster behind a closed wall is simply in unrevealed fog.
  type Seg = { id: string; x1: number; y1: number; x2: number; y2: number; kind: "wall" | "door" | "window"; open: boolean };
  const walls = (doorOpen: boolean): Seg[] => [
    { id: "w1", x1: 4, y1: 0, x2: 4, y2: 2, kind: "wall", open: false },
    { id: "d1", x1: 4, y1: 2, x2: 4, y2: 3, kind: "door", open: doorOpen },
    { id: "w2", x1: 4, y1: 3, x2: 4, y2: 10, kind: "wall", open: false },
  ];
  const at = (doorOpen: boolean) =>
    GameState.parse({
      campaignId: "c",
      locationId: "loc",
      monsters: [Monster.parse({ id: "m_behind", name: "Goblin", maxHp: 7, hp: 7 })],
      tokens: [
        { id: "t1", entityId: "pc", entityType: "character", x: 2, y: 2 },
        { id: "t2", entityId: "m_behind", entityType: "monster", x: 6, y: 2 },
      ],
      fog: { loc: { enabled: true, revealed: visibleCells(2, 2, 6, 12, 10, walls(doorOpen)) } },
    });

  it("is hidden while the door is closed and shown once it is open", () => {
    expect(monsterShownOnTable(at(false))("m_behind")).toBe(false);
    expect(monsterShownOnTable(at(true))("m_behind")).toBe(true);
  });
});

describe("momentForTable", () => {
  type M = { id: string; kind: string; targetId?: string; outcome?: string; text?: string; ts: number };
  const momentForTable = (s: ReturnType<typeof state>, m: M) => (visibility as unknown as { momentForTable: (s: unknown, m: M) => M | null }).momentForTable(s, m);
  const mo = (kind: string, targetId?: string, outcome?: string): M => ({ id: `mo_${kind}_${targetId ?? "x"}`, kind, targetId, outcome, ts: 1 });

  it("drops death, revived and turn_start moments of a monster the table can't see", () => {
    const s = state();
    for (const id of ["m_hid", "m_fog"]) {
      expect(momentForTable(s, mo("death", id, "monster"))).toBeNull();
      expect(momentForTable(s, mo("turn_start", id))).toBeNull();
      expect(momentForTable(s, mo("revived", id))).toBeNull();
    }
  });

  it("drops an attitude moment of a hidden monster but keeps it for a shown one", () => {
    const s = state();
    for (const id of ["m_hid", "m_fog"]) expect(momentForTable(s, mo("attitude", id, "friendly"))).toBeNull();
    const shown = mo("attitude", "m_vis", "hostile");
    expect(momentForTable(s, shown)).toBe(shown);
  });

  it("returns the moment unchanged for characters, shown monsters and untargeted moments", () => {
    const s = state();
    for (const m of [mo("death", "m_vis", "monster"), mo("turn_start", "m_vis"), mo("turn_start", "pc"), mo("death", "pc"), mo("revived", "pc", "rallied")]) expect(momentForTable(s, m)).toBe(m);
    for (const kind of ["victory", "defeat", "fled"]) {
      const m = mo(kind);
      expect(momentForTable(s, m)).toBe(m);
    }
    const end = { ...mo("campaign_end"), outcome: "success", text: "Fin." };
    expect(momentForTable(s, end)).toBe(end);
  });
});

describe("map objects and interactive features on the TV (V1, V2)", () => {
  type Obj = { id: string; locationId: string; kind: "loot" | "interactable"; name: string; x: number; y: number; items: never[]; gold: number; discovered: boolean; used: boolean; hidden: boolean };
  type Fn = (s: unknown) => (o: unknown) => boolean;
  const mapObjectShownOnTable = (visibility as unknown as { mapObjectShownOnTable: Fn }).mapObjectShownOnTable;
  const interactiveFeatureShownOnTable = (visibility as unknown as { interactiveFeatureShownOnTable: Fn }).interactiveFeatureShownOnTable;
  const obj = (o: Partial<Obj>): Obj => ({ id: "o", locationId: "loc", kind: "loot", name: "Loot", x: 1, y: 1, items: [], gold: 0, discovered: true, used: false, hidden: false, ...o });

  it("exports both helpers", () => {
    expect(typeof mapObjectShownOnTable).toBe("function");
    expect(typeof interactiveFeatureShownOnTable).toBe("function");
  });

  it("shows a map object in revealed cells of the current location unless hidden", () => {
    const shown = mapObjectShownOnTable(state());
    expect(shown(obj({ x: 1, y: 1 }))).toBe(true);
    expect(shown(obj({ x: 1, y: 1, kind: "interactable" }))).toBe(true);
    expect(shown(obj({ x: 9, y: 9 }))).toBe(false); // unrevealed fog
    expect(shown(obj({ x: 1, y: 1, hidden: true }))).toBe(false);
    expect(shown(obj({ x: 1, y: 1, locationId: "loc_other" }))).toBe(false);
  });

  it("shows everything of the current location when fog is off", () => {
    const s = state();
    s.fog = {};
    const shown = mapObjectShownOnTable(s);
    expect(shown(obj({ x: 9, y: 9 }))).toBe(true);
    expect(shown(obj({ x: 9, y: 9, hidden: true }))).toBe(false);
  });

  it("an interactive feature is shown when any of its cells is visible; plain features never", () => {
    const shown = interactiveFeatureShownOnTable(state());
    const f = (o: Record<string, unknown>) => ({ name: "lever", kind: "feature", lit: false, blocks: false, interactive: true, x: 0, y: 0, w: 1, h: 1, ...o });
    expect(shown(f({ x: 1, y: 1 }))).toBe(true);
    expect(shown(f({ x: 0, y: 0, w: 2, h: 2 }))).toBe(true); // 1,1 is revealed
    expect(shown(f({ x: 8, y: 8, w: 2, h: 2 }))).toBe(false);
    expect(shown(f({ x: 1, y: 1, interactive: false }))).toBe(false);
  });
});
