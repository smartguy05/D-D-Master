import { describe, expect, it } from "vitest";
import { FLOOR_MAX_HOLD_MS, FLOOR_TAIL_MS } from "@dm/shared";
import { Floor, sameHolder } from "./floor.js";

const sam = { playerId: "p_sam", inRoom: true };
const ana = { playerId: "p_ana", inRoom: false };
const room = { room: true as const };

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

describe("sameHolder", () => {
  it("matches the room with the room and a seat with the same seat", () => {
    expect(sameHolder(room, { room: true })).toBe(true);
    expect(sameHolder(sam, { playerId: "p_sam", inRoom: false })).toBe(true);
    expect(sameHolder(sam, ana)).toBe(false);
    expect(sameHolder(sam, room)).toBe(false);
    expect(sameHolder(null, room)).toBe(false);
  });
});

describe("Floor", () => {
  it("first speaker wins: a press while someone else holds is refused", () => {
    const c = clock();
    const f = new Floor({ now: c.now });
    expect(f.holder).toBeNull();
    expect(f.press(sam)).toBe(true);
    expect(f.press(ana)).toBe(false);
    expect(f.press(room)).toBe(false);
    expect(f.holder).toEqual(sam);
  });

  it("pressing again while holding is a no-op that keeps the original start (no cap reset)", () => {
    const c = clock();
    const f = new Floor({ now: c.now });
    f.press(sam);
    c.t += 20_000;
    expect(f.press(sam)).toBe(true);
    c.t += 10_001;
    expect(f.holder).toBeNull();
  });

  it("only the holder releases it; then someone else may press", () => {
    const c = clock();
    const f = new Floor({ now: c.now });
    f.press(sam);
    expect(f.release(ana)).toBe(false);
    expect(f.holder).toEqual(sam);
    expect(f.release(sam)).toBe(true);
    expect(f.holder).toBeNull();
    expect(f.release(sam)).toBe(false);
    expect(f.press(ana)).toBe(true);
  });

  it("releases on its own after the max hold", () => {
    const c = clock();
    const f = new Floor({ now: c.now });
    f.press(sam);
    c.t += FLOOR_MAX_HOLD_MS - 1;
    expect(f.expire()).toBe(false);
    expect(f.holder).toEqual(sam);
    c.t += 1;
    expect(f.expire()).toBe(true);
    expect(f.holder).toBeNull();
    // The interval ends at the cap, not at the time somebody noticed.
    c.t += 5_000;
    expect(f.activeAt(c.t)).toBe(false);
    expect(f.holderDuring(c.t - 5_000 - FLOOR_TAIL_MS + 10, c.t)).toEqual(sam);
  });

  it("activeAt covers the hold plus the tail after release", () => {
    const c = clock();
    const f = new Floor({ now: c.now });
    const t0 = c.t;
    expect(f.activeAt(t0)).toBe(false);
    f.press(room);
    expect(f.activeAt(t0)).toBe(true);
    c.t += 2_000;
    f.release(room);
    expect(f.activeAt(c.t + FLOOR_TAIL_MS)).toBe(true);
    expect(f.activeAt(c.t + FLOOR_TAIL_MS + 1)).toBe(false);
    expect(f.activeAt(t0 - 1)).toBe(false);
  });

  it("holderDuring picks the holder that overlapped the speech window most", () => {
    const c = clock(0);
    const f = new Floor({ now: c.now, tailMs: 0 });
    f.press(sam);
    c.t = 1_000;
    f.release(sam);
    c.t = 1_200;
    f.press(ana);
    c.t = 4_000;
    f.release(ana);
    expect(f.holderDuring(500, 3_000)).toEqual(ana); // sam 500 ms, ana 1800 ms
    expect(f.holderDuring(0, 1_300)).toEqual(sam); // sam 1000 ms, ana 100 ms
    expect(f.holderDuring(5_000, 6_000)).toBeUndefined();
    expect(f.covered(5_000, 6_000)).toBe(false);
    expect(f.covered(3_900, 6_000)).toBe(true);
  });

  it("a hold still in progress covers a window up to now and beyond", () => {
    const c = clock(0);
    const f = new Floor({ now: c.now });
    f.press(room);
    c.t = 3_000;
    expect(f.holderDuring(1_000, 2_500)).toEqual(room);
    expect(f.covered(2_900, 3_500)).toBe(true);
  });

  it("speech that ends inside the tail counts as covered", () => {
    const c = clock(0);
    const f = new Floor({ now: c.now });
    f.press(sam);
    c.t = 2_000;
    f.release(sam);
    expect(f.covered(2_000 + FLOOR_TAIL_MS - 100, 2_900)).toBe(true);
    expect(f.covered(2_000 + FLOOR_TAIL_MS + 1, 2_900)).toBe(false);
  });

  it("clear drops the holder and the timeline", () => {
    const c = clock(0);
    const f = new Floor({ now: c.now });
    f.press(sam);
    c.t = 1_000;
    f.clear();
    expect(f.holder).toBeNull();
    expect(f.covered(0, 1_000)).toBe(false);
  });

  it("forgets intervals older than keepMs", () => {
    const c = clock(0);
    const f = new Floor({ now: c.now, keepMs: 10_000, tailMs: 0 });
    f.press(sam);
    c.t = 1_000;
    f.release(sam);
    c.t = 20_000;
    f.press(ana); // pruning happens on change
    expect(f.covered(0, 1_000)).toBe(false);
    expect(f.covered(19_000, 21_000)).toBe(true);
  });

  it("returns copies, so a caller can't change the holder", () => {
    const f = new Floor({ now: () => 0 });
    f.press({ playerId: "p_sam", inRoom: true });
    const h = f.holder as { playerId: string };
    h.playerId = "p_x";
    expect(f.holder).toEqual(sam);
  });
});
