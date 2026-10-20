import { describe, expect, it } from "vitest";
import { Character, GameState, Monster } from "@dm/shared";
import { nowPanelFor } from "./nowPanel";

function state(turnOf?: string) {
  const s = GameState.parse({
    campaignId: "c",
    locationId: "loc",
    characters: [Character.parse({ id: "pc", playerName: "Sam", name: "Mara", maxHp: 12, hp: 7, spriteUrl: "/media/c/mara.png", conditions: ["Poisoned"] })],
    monsters: [
      Monster.parse({ id: "m_vis", name: "Goblin Boss", maxHp: 20, hp: 20, spriteUrl: "/media/c/gob.png", conditions: ["Prone"] }),
      Monster.parse({ id: "m_hid", name: "Assassin", maxHp: 30, hp: 30, hidden: true, spriteUrl: "/media/c/ass.png", conditions: ["Invisible"] }),
      Monster.parse({ id: "m_fog", name: "Lurker", maxHp: 10, hp: 10, spriteUrl: "/media/c/lurk.png" }),
    ],
    tokens: [
      { id: "t1", entityId: "pc", entityType: "character", x: 1, y: 1 },
      { id: "t2", entityId: "m_vis", entityType: "monster", x: 2, y: 1 },
      { id: "t3", entityId: "m_hid", entityType: "monster", x: 1, y: 2 },
      { id: "t4", entityId: "m_fog", entityType: "monster", x: 9, y: 9 },
    ],
    fog: { loc: { enabled: true, revealed: ["1,1", "1,2", "2,1"] } },
  });
  const order = [
    { entityId: "pc", entityType: "character" as const, name: "Mara", initiative: 18 },
    { entityId: "m_vis", entityType: "monster" as const, name: "Goblin Boss", initiative: 15 },
    { entityId: "m_hid", entityType: "monster" as const, name: "Assassin", initiative: 12 },
    { entityId: "m_fog", entityType: "monster" as const, name: "Lurker", initiative: 8 },
  ];
  if (turnOf) {
    s.combat.active = true;
    s.combat.round = 1;
    s.combat.order = order;
    s.combat.turnIndex = order.findIndex((o) => o.entityId === turnOf);
  }
  return s;
}

describe("nowPanelFor", () => {
  it("is null out of combat", () => {
    expect(nowPanelFor(state())).toBeNull();
  });

  it("a player character's turn shows name, portrait, exact HP and conditions", () => {
    expect(nowPanelFor(state("pc"))).toMatchObject({ name: "Mara", portraitUrl: "/media/c/mara.png", hp: "7/12", conditions: ["Poisoned"] });
  });

  it("a shown monster's turn shows an HP band, never exact HP", () => {
    const p = nowPanelFor(state("m_vis"))!;
    expect(p).toMatchObject({ name: "Goblin Boss", portraitUrl: "/media/c/gob.png", hpBand: "healthy", conditions: ["Prone"] });
    expect(p).not.toHaveProperty("hp");
    expect(JSON.stringify(p)).not.toContain("20");
  });

  it("uses the foe list's bands: healthy > 1/2, bloodied > 1/4, near death, defeated at 0", () => {
    const band = (hp: number) => {
      const s = state("m_vis");
      s.monsters[0].hp = hp;
      return nowPanelFor(s)!.hpBand;
    };
    expect(band(11)).toBe("healthy");
    expect(band(10)).toBe("bloodied");
    expect(band(6)).toBe("bloodied");
    expect(band(5)).toBe("near death");
    expect(band(1)).toBe("near death");
    expect(band(0)).toBe("defeated");
  });

  it("a hidden monster's turn (host-hidden or in unseen fog) is an unknown foe with nothing else", () => {
    expect(nowPanelFor(state("m_hid"))).toEqual({ name: "Unknown foe", hidden: true });
    expect(nowPanelFor(state("m_fog"))).toEqual({ name: "Unknown foe", hidden: true });
  });
});
