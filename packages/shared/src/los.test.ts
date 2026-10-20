import { describe, expect, it } from "vitest";
import { blocksMove, blocksSight, coverBetween, coverNote, edgeBlocked, hasLineOfSight, moveBlocked, visibleCells } from "./los.js";
import * as shared from "./index.js";
import { cellKey, cellsInRadius } from "./fog.js";
import { WallSeg } from "./schemas.js";

// Line of sight, cover and wall movement (Phase 1: walls, doors, LOS, cover). Coordinates of a
// segment are grid-line intersections; cell (x, y) is the square [x, x+1] x [y, y+1].

type Kind = "wall" | "door" | "window";
let n = 0;
const seg = (x1: number, y1: number, x2: number, y2: number, kind: Kind = "wall", open = false): WallSeg => ({ id: `s${++n}`, x1, y1, x2, y2, kind, open });
const c = (x: number, y: number) => ({ x, y });

describe("los module", () => {
  it("is re-exported from the package index", () => {
    const idx = shared as unknown as Record<string, unknown>;
    for (const name of ["blocksSight", "blocksMove", "edgeBlocked", "hasLineOfSight", "coverBetween", "visibleCells", "moveBlocked"]) {
      expect(typeof idx[name]).toBe("function");
    }
  });
});

describe("blocksSight / blocksMove (L1)", () => {
  it("a wall blocks both", () => {
    expect(blocksSight(seg(0, 0, 0, 1))).toBe(true);
    expect(blocksMove(seg(0, 0, 0, 1))).toBe(true);
  });
  it("a closed door blocks both, an open door neither", () => {
    expect(blocksSight(seg(0, 0, 0, 1, "door", false))).toBe(true);
    expect(blocksMove(seg(0, 0, 0, 1, "door", false))).toBe(true);
    expect(blocksSight(seg(0, 0, 0, 1, "door", true))).toBe(false);
    expect(blocksMove(seg(0, 0, 0, 1, "door", true))).toBe(false);
  });
  it("a window blocks movement but not sight", () => {
    expect(blocksSight(seg(0, 0, 0, 1, "window"))).toBe(false);
    expect(blocksMove(seg(0, 0, 0, 1, "window"))).toBe(true);
  });
  it("ignores the open flag on walls and windows", () => {
    expect(blocksSight(seg(0, 0, 0, 1, "wall", true))).toBe(true);
    expect(blocksMove(seg(0, 0, 0, 1, "wall", true))).toBe(true);
    expect(blocksSight(seg(0, 0, 0, 1, "window", true))).toBe(false);
    expect(blocksMove(seg(0, 0, 0, 1, "window", true))).toBe(true);
  });
});

describe("edgeBlocked (L2)", () => {
  const wall = [seg(3, 0, 3, 5)];
  it("blocks the shared edge of orthogonal neighbours covered by a segment", () => {
    expect(edgeBlocked(c(2, 1), c(3, 1), wall, "sight")).toBe(true);
    expect(edgeBlocked(c(3, 1), c(2, 1), wall, "move")).toBe(true);
    expect(edgeBlocked(c(2, 4), c(3, 4), wall, "sight")).toBe(true);
  });
  it("does not block past the segment's end", () => {
    expect(edgeBlocked(c(2, 6), c(3, 6), wall, "sight")).toBe(false);
    expect(edgeBlocked(c(2, 5), c(3, 5), wall, "move")).toBe(false); // the wall only touches this edge at (3,5)
  });
  it("horizontal segments block vertical neighbours", () => {
    const h = [seg(0, 2, 4, 2)];
    expect(edgeBlocked(c(1, 1), c(1, 2), h, "move")).toBe(true);
    expect(edgeBlocked(c(5, 1), c(5, 2), h, "move")).toBe(false);
  });
  it("is false for non-adjacent and diagonal pairs", () => {
    expect(edgeBlocked(c(1, 1), c(3, 1), wall, "sight")).toBe(false);
    expect(edgeBlocked(c(2, 1), c(3, 2), wall, "sight")).toBe(false);
    expect(edgeBlocked(c(2, 1), c(2, 1), wall, "sight")).toBe(false);
  });
  it("respects the mode: windows block moves only, open doors block nothing", () => {
    const win = [seg(3, 1, 3, 2, "window")];
    expect(edgeBlocked(c(2, 1), c(3, 1), win, "move")).toBe(true);
    expect(edgeBlocked(c(2, 1), c(3, 1), win, "sight")).toBe(false);
    const open = [seg(3, 1, 3, 2, "door", true)];
    expect(edgeBlocked(c(2, 1), c(3, 1), open, "move")).toBe(false);
    expect(edgeBlocked(c(2, 1), c(3, 1), open, "sight")).toBe(false);
    const closed = [seg(3, 1, 3, 2, "door", false)];
    expect(edgeBlocked(c(2, 1), c(3, 1), closed, "move")).toBe(true);
    expect(edgeBlocked(c(2, 1), c(3, 1), closed, "sight")).toBe(true);
  });
});

describe("hasLineOfSight (L3)", () => {
  it("is true with no walls and for the same cell", () => {
    expect(hasLineOfSight(c(0, 0), c(9, 7), [])).toBe(true);
    expect(hasLineOfSight(c(2, 1), c(2, 1), [seg(2, 1, 3, 1), seg(2, 2, 3, 2), seg(2, 1, 2, 2), seg(3, 1, 3, 2)])).toBe(true);
  });
  it("is false across a closed wall or closed door", () => {
    expect(hasLineOfSight(c(2, 1), c(3, 1), [seg(3, 0, 3, 5)])).toBe(false);
    expect(hasLineOfSight(c(2, 1), c(3, 1), [seg(3, 1, 3, 2, "door", false)])).toBe(false);
    expect(hasLineOfSight(c(2, 1), c(7, 2), [seg(3, 0, 3, 10)])).toBe(false);
  });
  it("is true across an open door or a window", () => {
    expect(hasLineOfSight(c(2, 1), c(3, 1), [seg(3, 1, 3, 2, "door", true)])).toBe(true);
    expect(hasLineOfSight(c(2, 1), c(3, 1), [seg(3, 1, 3, 2, "window")])).toBe(true);
  });
  it("is false through an L-shaped wall junction (touching an endpoint is blocked)", () => {
    const L = [seg(3, 0, 3, 3), seg(0, 3, 3, 3)];
    expect(hasLineOfSight(c(2, 2), c(3, 3), L)).toBe(false);
    expect(hasLineOfSight(c(3, 3), c(2, 2), L)).toBe(false);
  });
  it("is true past the free end of a wall when a clear corner line exists", () => {
    const stub = [seg(3, 0, 3, 2)];
    expect(hasLineOfSight(c(2, 1), c(3, 2), stub)).toBe(true);
    expect(hasLineOfSight(c(2, 1), c(3, 1), stub)).toBe(false);
  });
  it("is symmetric", () => {
    const walls = [seg(4, 0, 4, 2), seg(4, 3, 4, 5), seg(6, 0, 6, 3)];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) expect(hasLineOfSight(c(2, 3), c(x, y), walls)).toBe(hasLineOfSight(c(x, y), c(2, 3), walls));
  });
});

describe("coverBetween (L4)", () => {
  it("none when nothing is in the way", () => {
    expect(coverBetween(c(2, 2), c(6, 2), [])).toBe("none");
    expect(coverBetween(c(2, 2), c(6, 2), [], [c(4, 0), c(9, 9)])).toBe("none");
  });
  it("half behind the end of a wall", () => {
    expect(coverBetween(c(2, 1), c(6, 2), [seg(4, 0, 4, 2)])).toBe("half");
  });
  it("three-quarters behind a wall corner", () => {
    expect(coverBetween(c(2, 3), c(6, 2), [seg(6, 0, 6, 3)])).toBe("three-quarters");
  });
  it("total behind a full wall", () => {
    expect(coverBetween(c(2, 1), c(3, 1), [seg(3, 0, 3, 5)])).toBe("total");
    expect(coverBetween(c(2, 2), c(6, 2), [seg(4, 0, 4, 3)])).toBe("total");
  });
  it("a creature between attacker and target gives half cover", () => {
    expect(coverBetween(c(0, 2), c(4, 2), [], [c(2, 2)])).toBe("half");
  });
  it("blockers never make cover worse than half, and the attacker/target cells never count", () => {
    expect(coverBetween(c(0, 2), c(4, 2), [], [c(1, 2), c(2, 2), c(3, 2)])).toBe("half");
    expect(coverBetween(c(0, 2), c(4, 2), [], [c(0, 2), c(4, 2)])).toBe("none");
    // a wall already giving three-quarters stays three-quarters with a blocker too
    expect(coverBetween(c(2, 3), c(6, 2), [seg(6, 0, 6, 3)], [c(4, 3)])).toBe("three-quarters");
  });
  it("is total exactly when there is no line of sight", () => {
    const walls = [seg(4, 0, 4, 2), seg(4, 3, 4, 5), seg(6, 0, 6, 3), seg(0, 6, 5, 6, "door", false), seg(7, 4, 7, 8, "window")];
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++) {
        if (x === 2 && y === 3) continue;
        expect(coverBetween(c(2, 3), c(x, y), walls) === "total").toBe(!hasLineOfSight(c(2, 3), c(x, y), walls));
      }
  });
});

describe("visibleCells (L5)", () => {
  const W = 12;
  const H = 10;
  const keys = (xs: string[]) => new Set(xs);

  it("equals cellsInRadius with no walls, or only windows and open doors", () => {
    expect(keys(visibleCells(2, 2, 6, W, H, []))).toEqual(keys(cellsInRadius(2, 2, 6, W, H)));
    const seeThrough = [seg(4, 0, 4, 10, "window"), seg(0, 5, 12, 5, "door", true)];
    expect(keys(visibleCells(2, 2, 6, W, H, seeThrough))).toEqual(keys(cellsInRadius(2, 2, 6, W, H)));
  });

  it("is a subset of the radius and always includes the origin", () => {
    const walls = [seg(3, 2, 3, 3), seg(2, 3, 3, 3), seg(2, 2, 2, 3), seg(2, 2, 3, 2)]; // boxed in
    const v = visibleCells(2, 2, 6, W, H, walls);
    expect(v).toContain(cellKey(2, 2));
    const radius = keys(cellsInRadius(2, 2, 6, W, H));
    for (const k of v) expect(radius.has(k)).toBe(true);
  });

  it("a closed wall on x=4 hides every cell beyond it", () => {
    const v = visibleCells(2, 2, 6, W, H, [seg(4, 0, 4, H)]);
    for (const k of v) expect(Number(k.split(",")[0])).toBeLessThan(4);
    expect(v).toContain(cellKey(3, 2));
  });

  it("opening a door in that wall reveals the cells seen through the doorway, and only those", () => {
    const closed = [seg(4, 0, 4, 4), seg(4, 4, 4, 5, "door", false), seg(4, 5, 4, H)];
    const open = [seg(4, 0, 4, 4), seg(4, 4, 4, 5, "door", true), seg(4, 5, 4, H)];
    expect(visibleCells(2, 2, 6, W, H, closed).some((k) => Number(k.split(",")[0]) >= 4)).toBe(false);
    const v = keys(visibleCells(2, 2, 6, W, H, open));
    expect(v.has(cellKey(4, 4))).toBe(true); // straight through the doorway
    expect(v.has(cellKey(4, 2))).toBe(false); // behind the wall beside the door
    expect(v.has(cellKey(7, 2))).toBe(false);
    for (const k of cellsInRadius(2, 2, 6, W, H)) {
      const [x, y] = k.split(",").map(Number);
      expect(v.has(k)).toBe(hasLineOfSight(c(2, 2), c(x!, y!), open));
    }
  });
});

describe("moveBlocked (L6)", () => {
  it("is true when the centre line crosses a wall, closed door or window", () => {
    expect(moveBlocked(c(2, 1), c(4, 1), [seg(3, 0, 3, 5)])).toBe(true);
    expect(moveBlocked(c(2, 1), c(4, 1), [seg(3, 1, 3, 2, "door", false)])).toBe(true);
    expect(moveBlocked(c(2, 1), c(4, 1), [seg(3, 1, 3, 2, "window")])).toBe(true);
  });
  it("is false through an open door or past the wall", () => {
    expect(moveBlocked(c(2, 1), c(4, 1), [seg(3, 1, 3, 2, "door", true)])).toBe(false);
    expect(moveBlocked(c(2, 6), c(4, 6), [seg(3, 0, 3, 5)])).toBe(false);
    expect(moveBlocked(c(0, 0), c(9, 9), [])).toBe(false);
  });
  it("touching a segment end counts (inclusive)", () => {
    // centres (2.5, 4.5) -> (4.5, 6.5) pass exactly through (3, 5), the wall's end
    expect(moveBlocked(c(2, 4), c(4, 6), [seg(3, 0, 3, 5)])).toBe(true);
  });
  it("never blocks a move to the same cell", () => {
    expect(moveBlocked(c(2, 1), c(2, 1), [seg(2, 1, 3, 1), seg(2, 1, 2, 2)])).toBe(false);
  });
});

describe("coverNote (roll breakdown)", () => {
  it("names the cover and the raised AC", () => {
    expect(coverNote({ cover: "half", dc: 15, secret: false })).toBe(" vs AC 15 (half cover +2)");
    expect(coverNote({ cover: "three-quarters", dc: 18, secret: false })).toBe(" vs AC 18 (three-quarters cover +5)");
    expect(coverNote({ cover: "half", dc: undefined, secret: false })).toBe(" (half cover +2)");
  });
  it("is empty without cover or for a secret roll", () => {
    expect(coverNote({ cover: undefined, dc: 15, secret: false })).toBe("");
    expect(coverNote({ cover: "half", dc: 15, secret: true })).toBe("");
  });
});
