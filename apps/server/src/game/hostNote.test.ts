import { describe, expect, it } from "vitest";
import { emptyGameState, type GameState, type Monster } from "@dm/shared";
import { hostActionNote } from "./hostNote.js";

const ogre = (over: Partial<Monster> = {}): Monster => ({
  id: "m_ogre",
  name: "Ogre",
  maxHp: 68,
  hp: 68,
  ac: 11,
  initiativeBonus: -1,
  speed: 40,
  attacksPerAction: 1,
  attacks: [{ name: "Greatclub", toHit: 6, damage: "2d8+4" }],
  conditions: [],
  hidden: false,
  npc: false,
  appearance: "",
  ally: false,
  follows: false,
  combatant: true,
  neutral: false,
  conditionMeta: [],
  ...over,
});

function withOgre(): GameState {
  const s = emptyGameState("c1");
  s.monsters.push(ogre());
  return s;
}

describe("hostActionNote", () => {
  it("describes a host spawn for the DM", () => {
    const note = hostActionNote("spawn_monster", { name: "Ogre", count: 1 }, emptyGameState("c1"), withOgre());
    expect(note).toMatch(/^Host did:/);
    expect(note).toContain("spawn_monster");
    expect(note).toContain("Ogre");
  });

  it("mentions end_combat", () => {
    const before = withOgre();
    before.combat.active = true;
    const note = hostActionNote("end_combat", {}, before, withOgre());
    expect(note).toMatch(/^Host did:/);
    expect(note).toContain("end_combat");
  });

  it("returns null for chatty Board-tab edits (fog strokes, token drags)", () => {
    expect(hostActionNote("edit_fog", { cells: [] }, emptyGameState("c1"), emptyGameState("c1"))).toBeNull();
    expect(hostActionNote("move_token", { entity_id: "m_ogre", x: 1, y: 1 }, withOgre(), withOgre())).toBeNull();
  });

  it("includes a roll's result", () => {
    expect(hostActionNote("roll_dice", { notation: "1d20", label: "DM roll" }, withOgre(), withOgre(), { total: 14 })).toContain("result 14");
  });

  it("names creatures by name, not id (from the state before the change)", () => {
    const note = hostActionNote("remove_monster", { monster_id: "m_ogre" }, withOgre(), emptyGameState("c1"));
    expect(note).toMatch(/^Host did:/);
    expect(note).toContain("remove_monster");
    expect(note).toContain("Ogre");
  });
});
