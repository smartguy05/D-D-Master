import { describe, expect, it } from "vitest";
import { Character, CustomSpecies, Player } from "@dm/shared";
import { buildSeats, NEW_SEAT, pickSelected, speciesSummary } from "./seats";

const player = (id: string, characterId?: string) => Player.parse({ id, name: id.toUpperCase(), characterId });
const character = (id: string) => Character.parse({ id, playerName: "", name: `Hero ${id}`, maxHp: 10, hp: 10 });

describe("buildSeats", () => {
  it("one seat per player, in order, with the character they hold", () => {
    const seats = buildSeats([player("a", "c2"), player("b")], [character("c1"), character("c2")]);
    expect(seats.slice(0, 2).map((s) => [s.key, s.player?.id, s.character?.id])).toEqual([
      ["p:a", "a", "c2"],
      ["p:b", "b", undefined],
    ]);
  });

  it("characters nobody holds get their own seat after the players", () => {
    const seats = buildSeats([player("a", "c2")], [character("c1"), character("c2"), character("c3")]);
    expect(seats.map((s) => s.key)).toEqual(["p:a", "c:c1", "c:c3"]);
    expect(seats[1].player).toBeUndefined();
  });

  it("a player pointing at a deleted character is an empty seat", () => {
    expect(buildSeats([player("a", "gone")], [])[0].character).toBeUndefined();
  });
});

describe("pickSelected", () => {
  const seats = buildSeats([player("a"), player("b")], []);

  it("keeps the selection while that seat exists", () => {
    expect(pickSelected(seats, "p:b")).toBe("p:b");
    expect(pickSelected(seats, NEW_SEAT)).toBe(NEW_SEAT);
  });

  it("falls back to the first seat when the selected one is gone or nothing is selected", () => {
    expect(pickSelected(seats, "p:removed")).toBe("p:a");
    expect(pickSelected(seats, null)).toBe("p:a");
    expect(pickSelected([], "p:a")).toBeNull();
  });
});

describe("speciesSummary", () => {
  it("type, speed, darkvision and counts on one line", () => {
    const s = CustomSpecies.parse({ name: "Brown Rat", darkvision: 60, traits: [{ name: "A" }, { name: "B" }], choices: [{ key: "size", label: "Size", kind: "size" }] });
    expect(speciesSummary(s)).toBe("Humanoid · 30 ft · darkvision 60 · 2 traits · 1 choice");
  });

  it("skips darkvision 0 and empty lists", () => {
    expect(speciesSummary(CustomSpecies.parse({ name: "Gambian", speed: 35, darkvision: 0, traits: [{ name: "A" }] }))).toBe("Humanoid · 35 ft · 1 trait");
  });
});
