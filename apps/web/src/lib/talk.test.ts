import { describe, expect, it } from "vitest";
import { reduceTalk } from "./talk";

describe("reduceTalk", () => {
  it("starts with an unknown talker, then a provisional match", () => {
    const a = reduceTalk(null, { who: "player", active: true, level: 0 });
    expect(a).toEqual({});
    const b = reduceTalk(a, { who: "player", active: true, level: 0.4, playerId: "p1", provisional: true });
    expect(b).toEqual({ playerId: "p1", provisional: true });
  });

  it("level-only updates keep the same object (no re-render)", () => {
    const a = reduceTalk(null, { who: "player", active: true, level: 0.1, playerId: "p1", provisional: true });
    expect(reduceTalk(a, { who: "player", active: true, level: 0.9, playerId: "p1", provisional: true })).toBe(a);
  });

  it("stops", () => {
    expect(reduceTalk({ playerId: "p1" }, { who: "player", active: false })).toBeNull();
  });
});
