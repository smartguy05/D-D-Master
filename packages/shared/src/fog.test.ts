import { describe, expect, it } from "vitest";
import { activeFog, cellKey, cellsInRadius, cellsInRect, lightRadiusOf, parseCellKey, visibilityOf } from "./fog.js";
import { DEFAULT_LIGHT_RADIUS } from "./schemas.js";
import { ToolArgs } from "./tools.js";

describe("fog helpers", () => {
  it("round-trips cell keys", () => {
    expect(cellKey(3, 7)).toBe("3,7");
    expect(parseCellKey("3,7")).toEqual({ x: 3, y: 7 });
    expect(parseCellKey("nope")).toBeNull();
  });

  it("builds round radius areas clipped to the grid", () => {
    expect(cellsInRadius(5, 5, 0, 10, 10)).toEqual(["5,5"]);
    expect(cellsInRadius(5, 5, 1, 10, 10)).toHaveLength(9); // r=1 is every adjacent cell
    expect(cellsInRadius(0, 0, 1, 10, 10).sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
    expect(new Set(cellsInRadius(5, 5, 2, 10, 10)).has("7,7")).toBe(false); // corners are cut
    const r6 = new Set(cellsInRadius(10, 10, 6, 30, 30));
    expect(r6.has("16,10")).toBe(true);
    expect(r6.has("15,14")).toBe(true); // 5²+4²=41 ≤ 42
    expect(r6.has("16,16")).toBe(false);
  });

  it("builds rectangles clipped to the grid", () => {
    expect(cellsInRect(8, 8, 4, 4, 10, 10).sort()).toEqual(["8,8", "8,9", "9,8", "9,9"]);
    expect(cellsInRect(-1, 0, 2, 1, 10, 10)).toEqual(["0,0"]);
  });

  it("defaults light radius to a torch", () => {
    expect(lightRadiusOf({})).toBe(DEFAULT_LIGHT_RADIUS);
    expect(lightRadiusOf({ lightRadius: 12 })).toBe(12);
  });

  it("visibility is everything without fog and only revealed cells with it", () => {
    expect(visibilityOf({ fog: {}, locationId: "a" })(1, 1)).toBe(true);
    const off = { fog: { a: { enabled: false, revealed: [] } }, locationId: "a" };
    expect(activeFog(off)).toBeUndefined();
    expect(visibilityOf(off)(1, 1)).toBe(true);
    const on = { fog: { a: { enabled: true, revealed: ["1,1"] } }, locationId: "a" };
    expect(visibilityOf(on)(1, 1)).toBe(true);
    expect(visibilityOf(on)(2, 1)).toBe(false);
  });
});

describe("fog and effect tool schemas", () => {
  it("reveal_area defaults the radius and accepts rectangles", () => {
    expect(ToolArgs.reveal_area.parse({ x: 1, y: 2 })).toEqual({ x: 1, y: 2, radius: 3 });
    expect(ToolArgs.reveal_area.parse({ x: 1, y: 2, w: 3, h: 4 })).toMatchObject({ w: 3, h: 4 });
    expect(() => ToolArgs.reveal_area.parse({ x: 1 })).toThrow();
  });

  it("set_fog only accepts known modes", () => {
    expect(ToolArgs.set_fog.parse({ mode: "enable" })).toEqual({ mode: "enable" });
    expect(() => ToolArgs.set_fog.parse({ mode: "maybe" })).toThrow();
  });

  it("play_effect validates the kind", () => {
    expect(ToolArgs.play_effect.parse({ kind: "fireball", x: 3, y: 4, radius: 4 })).toMatchObject({ kind: "fireball" });
    expect(() => ToolArgs.play_effect.parse({ kind: "confetti" })).toThrow();
  });
});
