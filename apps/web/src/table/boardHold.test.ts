import { describe, expect, it } from "vitest";
import { Character, GameState, Monster } from "@dm/shared";
import { HOLD_CAP_MS } from "./effectPlan";
import { displayState, emptyHold, holdBoard } from "./boardHold";

function game(over: { goblinHp?: number; goblin?: boolean; maraHp?: number; locationId?: string } = {}) {
  const s = GameState.parse({ campaignId: "c", locationId: over.locationId ?? "loc" });
  s.characters.push(Character.parse({ id: "pc", playerName: "Sam", name: "Mara", maxHp: 12, hp: over.maraHp ?? 12 }));
  s.tokens.push({ id: "t_pc", entityId: "pc", entityType: "character", x: 1, y: 1, size: 1 });
  if (over.goblin !== false) {
    s.monsters.push(Monster.parse({ id: "gob", name: "Goblin", maxHp: 11, hp: over.goblinHp ?? 11 }));
    s.tokens.push({ id: "t_gob", entityId: "gob", entityType: "monster", x: 3, y: 1, size: 1 });
  }
  return s;
}
const idle = (now: number) => ({ busy: false, animating: [], now });
const busy = (now: number, animating: string[] = []) => ({ busy: true, animating, now });
const hpOf = (s: GameState, id: string) => [...s.characters, ...s.monsters].find((x) => x.id === id)?.hp;

describe("holdBoard HP (bug: hp-and-removal-before-dice)", () => {
  it("shows the state's HP at once when the table is idle", () => {
    const h = holdBoard(emptyHold(), game(), game({ goblinHp: 4 }), idle(0));
    expect(hpOf(displayState(game({ goblinHp: 4 }), h), "gob")).toBe(4);
  });

  it("keeps the old HP while the dice roll, through several hits, then shows the new HP", () => {
    let h = holdBoard(emptyHold(), game(), game({ goblinHp: 7 }), busy(0));
    h = holdBoard(h, game({ goblinHp: 7 }), game({ goblinHp: 2 }), busy(100));
    expect(hpOf(displayState(game({ goblinHp: 2 }), h), "gob")).toBe(11);
    h = holdBoard(h, game({ goblinHp: 2 }), game({ goblinHp: 2 }), idle(5000));
    expect(hpOf(displayState(game({ goblinHp: 2 }), h), "gob")).toBe(2);
  });

  it("holds a PC's HP too (a monster's hit), and lets go after HOLD_CAP_MS", () => {
    let h = holdBoard(emptyHold(), game(), game({ maraHp: 5 }), busy(0));
    expect(hpOf(displayState(game({ maraHp: 5 }), h), "pc")).toBe(12);
    h = holdBoard(h, game({ maraHp: 5 }), game({ maraHp: 5 }), busy(HOLD_CAP_MS));
    expect(hpOf(displayState(game({ maraHp: 5 }), h), "pc")).toBe(5);
  });
});

describe("holdBoard removed monsters (bug: hp-and-removal-before-dice)", () => {
  it("a monster removed while the dice roll stays on the board with its old HP", () => {
    let h = holdBoard(emptyHold(), game(), game({ goblinHp: 0 }), busy(0));
    h = holdBoard(h, game({ goblinHp: 0 }), game({ goblin: false }), busy(50));
    const shown = displayState(game({ goblin: false }), h);
    expect(shown.monsters.map((m) => m.id)).toEqual(["gob"]);
    expect(hpOf(shown, "gob")).toBe(11);
    expect(shown.tokens.find((t) => t.entityId === "gob")).toMatchObject({ x: 3, y: 1 });
  });

  it("after the dice it stays (at its final HP) while its death animation plays, then goes", () => {
    let h = holdBoard(emptyHold(), game({ goblinHp: 0 }), game({ goblin: false }), busy(0));
    h = holdBoard(h, game({ goblin: false }), game({ goblin: false }), { busy: false, animating: ["gob"], now: 3000 });
    const during = displayState(game({ goblin: false }), h);
    expect(hpOf(during, "gob")).toBe(0);
    h = holdBoard(h, game({ goblin: false }), game({ goblin: false }), idle(6000));
    expect(displayState(game({ goblin: false }), h).monsters).toEqual([]);
  });

  it("a monster removed while idle goes at once; a scene change drops lingering monsters", () => {
    expect(displayState(game({ goblin: false }), holdBoard(emptyHold(), game(), game({ goblin: false }), idle(0))).monsters).toEqual([]);
    const h = holdBoard(emptyHold(), game(), game({ goblin: false, locationId: "other" }), busy(0));
    expect(displayState(game({ goblin: false, locationId: "other" }), h).monsters).toEqual([]);
  });

  it("returns the same state object when nothing is held", () => {
    const s = game();
    expect(displayState(s, holdBoard(emptyHold(), s, s, busy(0)))).toBe(s);
  });
});
