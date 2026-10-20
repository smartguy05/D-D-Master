import { describe, expect, it } from "vitest";
import type { Moment } from "@dm/shared";
import { HOLD_CAP_MS } from "./effectPlan";
import {
  MOMENT_MS,
  dismiss,
  emptyMomentQueue,
  enqueueMoment,
  heldStanding,
  momentVariant,
  nextOverlay,
  releaseHeldMoments,
  soundForMoment,
  tokenFallen,
  tokenMomentPose,
  type MomentQueue,
  type MomentVariant,
} from "./momentPlan";

let n = 0;
const mo = (kind: Moment["kind"], over: Partial<Moment> = {}): Moment => ({ id: `mo_${++n}`, kind, ts: 0, ...over });

const VARIANTS: MomentVariant[] = ["victory", "defeat", "fled", "death", "monster_death", "revived", "rallied", "campaign_end", "turn_start"];
const FULL_SCREEN: MomentVariant[] = ["victory", "defeat", "fled", "death", "revived", "campaign_end", "turn_start"];

describe("momentVariant and MOMENT_MS", () => {
  it("maps each moment to its variant", () => {
    expect(momentVariant(mo("victory"))).toBe("victory");
    expect(momentVariant(mo("defeat"))).toBe("defeat");
    expect(momentVariant(mo("fled"))).toBe("fled");
    expect(momentVariant(mo("death", { targetId: "pc" }))).toBe("death");
    expect(momentVariant(mo("death", { targetId: "m1", outcome: "monster" }))).toBe("monster_death");
    expect(momentVariant(mo("revived", { targetId: "pc" }))).toBe("revived");
    expect(momentVariant(mo("revived", { targetId: "pc", outcome: "rallied" }))).toBe("rallied");
    expect(momentVariant(mo("campaign_end", { outcome: "success" }))).toBe("campaign_end");
    expect(momentVariant(mo("turn_start", { targetId: "pc" }))).toBe("turn_start");
  });

  it("gives every variant a duration up to 8 s: turn banner ~2 s, campaign end ~8 s", () => {
    for (const v of VARIANTS) {
      expect(MOMENT_MS[v]).toBeGreaterThan(0);
      expect(MOMENT_MS[v]).toBeLessThanOrEqual(8000);
    }
    expect(MOMENT_MS.turn_start).toBeGreaterThanOrEqual(1500);
    expect(MOMENT_MS.turn_start).toBeLessThanOrEqual(2500);
    expect(MOMENT_MS.campaign_end).toBeGreaterThanOrEqual(7000);
  });
});

describe("releaseHeldMoments", () => {
  const held = (m: Moment, heldAt: number) => ({ moment: m, heldAt });

  it("holds every moment while dice roll or board effects are held", () => {
    const list = [held(mo("death", { targetId: "m1", outcome: "monster" }), 0), held(mo("victory"), 0)];
    for (const tray of [
      { diceBusy: true, effectsHeld: false, now: 100 },
      { diceBusy: false, effectsHeld: true, now: 100 },
      { diceBusy: true, effectsHeld: true, now: 100 },
    ]) {
      const r = releaseHeldMoments(list, tray);
      expect(r.release).toEqual([]);
      expect(r.keep).toEqual(list);
    }
  });

  it("releases in arrival order once the tray is idle and no effect is held", () => {
    const a = mo("death", { targetId: "m1", outcome: "monster" });
    const b = mo("victory");
    const c = mo("turn_start", { targetId: "pc" });
    const r = releaseHeldMoments([held(a, 0), held(b, 5), held(c, 10)], { diceBusy: false, effectsHeld: false, now: 100 });
    expect(r.release).toEqual([a, b, c]);
    expect(r.keep).toEqual([]);
  });

  it("releases anything held for HOLD_CAP_MS even while busy", () => {
    const old = mo("victory");
    const fresh = mo("turn_start", { targetId: "pc" });
    const r = releaseHeldMoments([held(old, 0), held(fresh, HOLD_CAP_MS - 10)], { diceBusy: true, effectsHeld: true, now: HOLD_CAP_MS });
    expect(r.release).toEqual([old]);
    expect(r.keep).toEqual([held(fresh, HOLD_CAP_MS - 10)]);
  });
});

describe("overlay queue", () => {
  const push = (q: MomentQueue, ...ms: Moment[]) => ms.reduce((acc, m) => enqueueMoment(acc, m), q);
  const shown = (q: MomentQueue) => q.current?.moment.id;

  it("plays full-screen moments one at a time, first in first out, each for MOMENT_MS", () => {
    const a = mo("death", { targetId: "pc" });
    const b = mo("victory");
    let q = push(emptyMomentQueue(), a, b);
    q = nextOverlay(q, 1000);
    expect(shown(q)).toBe(a.id);
    q = nextOverlay(q, 1000 + MOMENT_MS.death - 1);
    expect(shown(q)).toBe(a.id);
    q = nextOverlay(q, 1000 + MOMENT_MS.death);
    expect(shown(q)).toBe(b.id);
    q = nextOverlay(q, 1000 + MOMENT_MS.death + MOMENT_MS.victory);
    expect(q.current).toBeNull();
  });

  it("every full-screen variant takes the slot", () => {
    for (const v of FULL_SCREEN) {
      const m =
        v === "campaign_end" ? mo("campaign_end", { outcome: "success" }) : v === "turn_start" ? mo("turn_start", { targetId: "pc" }) : mo(v as Moment["kind"], { targetId: "pc" });
      expect(shown(nextOverlay(push(emptyMomentQueue(), m), 0))).toBe(m.id);
    }
  });

  it("a new turn_start replaces a turn banner that has not been shown yet", () => {
    const busy = mo("victory");
    const t1 = mo("turn_start", { targetId: "pc_a" });
    const t2 = mo("turn_start", { targetId: "pc_b" });
    let q = nextOverlay(push(emptyMomentQueue(), busy), 0);
    q = push(q, t1, t2);
    q = nextOverlay(q, MOMENT_MS.victory);
    expect(shown(q)).toBe(t2.id);
    q = nextOverlay(q, MOMENT_MS.victory + MOMENT_MS.turn_start);
    expect(q.current).toBeNull();
  });

  it("rallied toasts and monster deaths never take the full-screen slot", () => {
    let q = push(emptyMomentQueue(), mo("revived", { targetId: "pc", outcome: "rallied" }), mo("death", { targetId: "m1", outcome: "monster" }));
    q = nextOverlay(q, 0);
    expect(q.current).toBeNull();
    const v = mo("victory");
    q = nextOverlay(push(q, v), 10);
    expect(shown(q)).toBe(v.id);
  });

  it("dismiss drops the current overlay (campaign end lingers until clicked)", () => {
    const end = mo("campaign_end", { outcome: "success", text: "Fin." });
    const next = mo("turn_start", { targetId: "pc" });
    let q = nextOverlay(push(emptyMomentQueue(), end, next), 0);
    expect(shown(q)).toBe(end.id);
    q = nextOverlay(q, 1000);
    expect(shown(q)).toBe(end.id);
    q = nextOverlay(dismiss(q), 1000);
    expect(shown(q)).toBe(next.id);
  });

  it("does not mutate the queue it is given", () => {
    const q0 = emptyMomentQueue();
    const snap = structuredClone(q0);
    enqueueMoment(q0, mo("victory"));
    nextOverlay(q0, 0);
    expect(q0).toEqual(snap);
  });
});

describe("soundForMoment", () => {
  it("picks a cue per variant", () => {
    expect(soundForMoment("victory")).toBe("victory");
    expect(soundForMoment("death")).toBe("death");
    expect(soundForMoment("revived")).toBe("revive");
    expect(soundForMoment("rallied")).toBe("chime");
    expect(soundForMoment("campaign_end")).toBe("campaign");
    expect(soundForMoment("turn_start")).toBe("chime");
    for (const v of ["defeat", "fled"] as const) {
      expect(soundForMoment(v)).toBeTruthy();
      expect(["victory", "chime", "fanfare", "campaign", "revive"]).not.toContain(soundForMoment(v));
    }
  });
});

describe("tokenMomentPose", () => {
  const finite = (p: Record<string, number>) => Object.values(p).forEach((x) => expect(Number.isFinite(x)).toBe(true));

  it("death and monster death: the standee tips to ~90 degrees within ~1 s and greys out", () => {
    for (const v of ["death", "monster_death"] as const) {
      expect(tokenMomentPose(v, 0).tilt).toBeCloseTo(0, 3);
      expect(tokenMomentPose(v, 0).desaturate).toBeCloseTo(0, 3);
      let prev = -1;
      for (let t = 0; t <= 1200; t += 50) {
        const tilt = tokenMomentPose(v, t).tilt;
        expect(tilt).toBeGreaterThanOrEqual(prev);
        prev = tilt;
      }
      expect(tokenMomentPose(v, 1100).tilt).toBeCloseTo(Math.PI / 2, 1);
      expect(tokenMomentPose(v, MOMENT_MS[v] * 3).tilt).toBeCloseTo(Math.PI / 2, 1);
      expect(tokenMomentPose(v, MOMENT_MS[v]).desaturate).toBeCloseTo(1, 2);
    }
  });

  it("revived: rises from ~90 degrees back to upright with a golden column that fades out", () => {
    expect(tokenMomentPose("revived", 0).tilt).toBeCloseTo(Math.PI / 2, 1);
    expect(tokenMomentPose("revived", MOMENT_MS.revived).tilt).toBeCloseTo(0, 2);
    const mid = Math.max(...[0.2, 0.3, 0.4, 0.5].map((f) => tokenMomentPose("revived", MOMENT_MS.revived * f).column));
    expect(mid).toBeGreaterThan(0.3);
    expect(tokenMomentPose("revived", MOMENT_MS.revived).column).toBeCloseTo(0, 2);
    expect(tokenMomentPose("revived", MOMENT_MS.revived * 5).column).toBeCloseTo(0, 2);
  });

  it("is clamped: negative or huge ages give finite values in range", () => {
    for (const v of VARIANTS) {
      for (const age of [-1000, -1, 0, 1e9, Number.POSITIVE_INFINITY]) {
        const p = tokenMomentPose(v, age);
        finite(p as unknown as Record<string, number>);
        expect(p.tilt).toBeGreaterThanOrEqual(0);
        expect(p.tilt).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
        expect(p.desaturate).toBeGreaterThanOrEqual(0);
        expect(p.desaturate).toBeLessThanOrEqual(1);
        expect(p.column).toBeGreaterThanOrEqual(0);
        expect(p.column).toBeLessThanOrEqual(1);
      }
    }
    expect(tokenMomentPose("death", 1e9)).toEqual(tokenMomentPose("death", MOMENT_MS.death * 2));
  });

  it("other variants give a neutral pose", () => {
    for (const v of ["victory", "defeat", "fled", "rallied", "campaign_end", "turn_start"] as const) {
      expect(tokenMomentPose(v, 300)).toEqual({ tilt: 0, desaturate: 0, column: 0 });
    }
  });
});

describe("tokens stay standing while their death moment is held (bug: token-falls-before-death-moment)", () => {
  it("heldStanding lists the targets of held death and monster_death moments only", () => {
    const held = [
      { moment: mo("death", { targetId: "m1", outcome: "monster" }), heldAt: 0 },
      { moment: mo("death", { targetId: "pc_a" }), heldAt: 0 },
      { moment: mo("revived", { targetId: "pc_b" }), heldAt: 0 },
      { moment: mo("victory"), heldAt: 0 },
    ];
    expect(heldStanding(held)).toEqual(["m1", "pc_a"]);
    expect(heldStanding([])).toEqual([]);
  });

  it("tokenFallen keeps a dead token up while its moment is held, and lies it down once released", () => {
    expect(tokenFallen(true, "m1", ["m1"])).toBe(false);
    expect(tokenFallen(true, "m1", [])).toBe(true);
    expect(tokenFallen(true, "m1", ["m2"])).toBe(true);
    expect(tokenFallen(false, "m1", ["m1"])).toBe(false);
  });
});
