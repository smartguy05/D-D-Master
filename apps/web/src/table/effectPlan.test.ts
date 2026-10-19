import { describe, expect, it } from "vitest";
import type { BoardEffect } from "@dm/shared";
import { NEUTRAL_SPARK, REACTION_MS, TRAVEL_DEDUPE_MS, planEffect, reactionPose, travelSuppressed, visualFor } from "./effectPlan";

let n = 0;
const fx = (e: Partial<BoardEffect>): BoardEffect => ({ id: `fx_${++n}`, kind: "hit", ts: 0, ...e });

describe("planEffect (recipe selection)", () => {
  it("melee attack: a swing, then the outcome on the target", () => {
    const p = planEffect(fx({ kind: "attack", style: "melee", sourceId: "a", targetId: "b", outcome: "hit" }), { distance: 1 });
    expect(p.travel).toBe("swing");
    expect(p.impact).toBe("slash");
    expect(p.reaction).toBe("hit");
    expect(p.impactAtMs).toBe(p.travelMs);
    expect(p.sounds.map((s) => s.name)).toEqual(["whoosh", "thud"]);
  });

  it("ranged attack: an arrow whose flight time grows with distance, capped under 1 s", () => {
    const near = planEffect(fx({ kind: "attack", style: "ranged", sourceId: "a", targetId: "b", outcome: "hit" }), { distance: 2 });
    const far = planEffect(fx({ kind: "attack", style: "ranged", sourceId: "a", targetId: "b", outcome: "hit" }), { distance: 40 });
    expect(near.travel).toBe("arrow");
    expect(far.travelMs).toBeGreaterThan(near.travelMs);
    expect(far.travelMs).toBeLessThanOrEqual(700);
    expect(near.sounds[0].name).toBe("twang");
  });

  it("miss and crit reactions", () => {
    const miss = planEffect(fx({ kind: "attack", style: "ranged", sourceId: "a", targetId: "b", outcome: "miss" }), { distance: 5 });
    expect(miss.reaction).toBe("miss");
    expect(miss.impact).toBe("miss");
    const crit = planEffect(fx({ kind: "attack", style: "melee", sourceId: "a", targetId: "b", outcome: "crit" }), { distance: 1 });
    expect(crit.impact).toBe("crit");
    expect(crit.sounds.at(-1)?.name).toBe("clang");
  });

  it("spell attack: an element-coloured orb; lightning is a bolt; darts are staggered", () => {
    const fire = planEffect(fx({ kind: "attack", style: "spell", element: "fire", sourceId: "a", targetId: "b", outcome: "hit" }), { distance: 6 });
    expect(fire.travel).toBe("orb");
    expect(fire.impact).toBe("fireball");
    expect(fire.color).toBe("#ff7a1a");
    const bolt = planEffect(fx({ kind: "attack", style: "spell", element: "lightning", sourceId: "a", targetId: "b" }), { distance: 6 });
    expect(bolt.travel).toBe("bolt");
    const darts = planEffect(fx({ kind: "attack", style: "spell", element: "force", sourceId: "a", targetId: "b", count: 3, outcome: "hit" }), { distance: 6 });
    const one = planEffect(fx({ kind: "attack", style: "spell", element: "force", sourceId: "a", targetId: "b", outcome: "hit" }), { distance: 6 });
    expect(darts.count).toBe(3);
    expect(darts.impactAtMs).toBeGreaterThan(one.impactAtMs);
    expect(darts.impactAtMs).toBeLessThan(1000);
  });

  it("an attack without a known outcome still lands (a spark), but does not shake as a hit", () => {
    const p = planEffect(fx({ kind: "attack", style: "melee", sourceId: "a", targetId: "b" }), { distance: 1 });
    expect(p.impact).toBe("spark");
    expect(p.reaction).toBeUndefined();
  });

  it("no source position, a source on the target's cell, or a suppressed travel with nothing to wait for: the landing plays at once", () => {
    const e = fx({ kind: "attack", style: "ranged", sourceId: "a", targetId: "b", outcome: "hit" });
    for (const p of [planEffect(e, {}), planEffect(e, { distance: 0.5 }), planEffect(e, { distance: 5, suppressed: true, waitMs: 0 })]) {
      expect(p.travel).toBeUndefined();
      expect(p.impactAtMs).toBe(0);
      expect(p.impact).toBe("spark");
    }
  });

  it("a hit with a source travels, then flashes in its damage type", () => {
    const p = planEffect(fx({ kind: "hit", style: "ranged", element: "piercing", sourceId: "a", targetId: "b" }), { distance: 4 });
    expect(p.travel).toBe("arrow");
    expect(p.impact).toBe("slash");
    expect(p.reaction).toBe("hit");
  });

  it("area: an orb lobbed from the caster then a ring of the area's radius", () => {
    const p = planEffect(fx({ kind: "area", style: "area", element: "fire", sourceId: "a", x: 3, y: 3, radius: 4, shape: "sphere" }), { distance: 8 });
    expect(p.travel).toBe("orb");
    expect(p.impact).toBe("area");
    expect(p.areaRadius).toBe(4);
    expect(p.sounds.at(-1)?.name).toBe("boom");
    // an emanation (on the caster) does not travel
    expect(planEffect(fx({ kind: "area", element: "radiant", sourceId: "a", targetId: "a", radius: 3, shape: "emanation" }), { distance: 0 }).travel).toBeUndefined();
  });

  it("legacy kinds keep their visual and play at once", () => {
    const p = planEffect(fx({ kind: "fireball", x: 1, y: 1, radius: 4 }), {});
    expect(p).toMatchObject({ impact: "fireball", impactAtMs: 0, travel: undefined });
    expect(planEffect(fx({ kind: "heal", targetId: "b" }), {}).reaction).toBe("heal");
    expect(visualFor("hit", "cold")).toBe("frost");
    expect(visualFor("attack", "fire")).toBe("fireball");
  });
});

describe("travelSuppressed (table-side dedupe)", () => {
  const rec = (effect: BoardEffect, receivedAt: number) => ({ effect, receivedAt });

  it("a second travel for the same source→target within 1.5 s only lands", () => {
    const a = fx({ kind: "attack", style: "melee", sourceId: "m1", targetId: "pc", outcome: "hit" });
    const b = fx({ kind: "hit", style: "melee", sourceId: "m1", targetId: "pc" });
    const c = fx({ kind: "hit", style: "melee", sourceId: "m1", targetId: "pc" });
    const s = travelSuppressed([rec(a, 0), rec(b, 800), rec(c, 800 + TRAVEL_DEDUPE_MS + 1)]);
    expect([...s.keys()]).toEqual([b.id]);
  });

  it("other pairs, effects without a source and area bursts don't suppress", () => {
    const a = fx({ kind: "attack", style: "melee", sourceId: "m1", targetId: "pc" });
    const other = fx({ kind: "attack", style: "melee", sourceId: "m2", targetId: "pc" });
    const plain = fx({ kind: "hit", targetId: "pc" });
    const area = fx({ kind: "area", sourceId: "m1", targetId: "pc", radius: 2 });
    const later = fx({ kind: "attack", style: "melee", sourceId: "m1", targetId: "pc" });
    const s = travelSuppressed([rec(area, 0), rec(a, 100), rec(other, 200), rec(plain, 300), rec(later, 100 + TRAVEL_DEDUPE_MS + 10)]);
    expect(s.size).toBe(0);
  });

  it("an orb from cast_spell then the spell's attack roll: the roll only shows its outcome", () => {
    const orb = fx({ kind: "attack", style: "spell", sourceId: "pc_w", targetId: "m1", element: "fire" });
    const roll = fx({ kind: "attack", style: "spell", sourceId: "pc_w", targetId: "m1", element: "fire", outcome: "miss" });
    expect(travelSuppressed([rec(orb, 0), rec(roll, 600)]).has(roll.id)).toBe(true);
  });
});

// Review round 1 (2026-10-18): a spell-attack cast is travel only; the roll's outcome waits for the orb.
describe("review round 1", () => {
  const fxId = (id: string, e: Partial<BoardEffect>): BoardEffect => ({ id, kind: "hit", ts: 0, ...e });

  describe("cast_spell Fire Bolt followed by its attack roll", () => {
    // Server: cast_spell Fire Bolt emits {kind:"attack", style:"spell", element:"fire"} with no outcome;
    // the DM then rolls the attack with target_id (persona) -> {kind:"attack", outcome:"miss"}.
    const cast = fxId("cast", { kind: "attack", style: "spell", element: "fire", sourceId: "pc_w", targetId: "m1", label: "Fire Bolt" });
    const roll = fxId("roll", { kind: "attack", style: "spell", element: "fire", sourceId: "pc_w", targetId: "m1", label: "Fire Bolt", outcome: "miss" });

    it("a missed Fire Bolt does not first explode in fire on the target", () => {
      const list = [
        { effect: cast, receivedAt: 0 },
        { effect: roll, receivedAt: 600 },
      ];
      const sup = travelSuppressed(list);
      const castPlan = planEffect(cast, { distance: 6, suppressed: sup.has("cast") });
      const rollPlan = planEffect(roll, { distance: 6, suppressed: sup.has("roll") });
      expect(rollPlan.impact).toBe("miss");
      // the cast's orb lands as a full fireball burst although the attack missed
      expect(castPlan.impact).not.toBe("fireball");
    });

    it("the roll's outcome does not land before the cast's orb arrives", () => {
      const list = [
        { effect: cast, receivedAt: 0 },
        { effect: roll, receivedAt: 100 },
      ];
      const sup = travelSuppressed(list);
      const castPlan = planEffect(cast, { distance: 10, suppressed: sup.has("cast") });
      const rollPlan = planEffect(roll, { distance: 10, suppressed: sup.has("roll") });
      expect(100 + rollPlan.impactAtMs).toBeGreaterThanOrEqual(0 + castPlan.impactAtMs);
    });
  });
});

describe("review round 1: travel-only spell orbs and waiting follow-ups", () => {
  it("a spell orb without an outcome lands as a small neutral spark", () => {
    const p = planEffect(fx({ kind: "attack", style: "spell", element: "fire", sourceId: "a", targetId: "b" }), { distance: 6 });
    expect(p.travel).toBe("orb");
    expect(p.color).toBe("#ff7a1a"); // the orb keeps its element colour
    expect(p).toMatchObject({ impact: "spark", tint: NEUTRAL_SPARK, reaction: undefined });
  });

  it("travel distance 0.5 or less never travels", () => {
    expect(planEffect(fx({ kind: "attack", style: "melee", sourceId: "a", targetId: "b", outcome: "hit" }), { distance: 0.5 }).travel).toBeUndefined();
    expect(planEffect(fx({ kind: "attack", style: "melee", sourceId: "a", targetId: "b", outcome: "hit" }), { distance: 0.51 }).travel).toBe("swing");
  });

  it("a suppressed follow-up waits waitMs, else the travel time it would have had", () => {
    const e = fx({ kind: "attack", style: "spell", element: "fire", sourceId: "a", targetId: "b", outcome: "miss" });
    expect(planEffect(e, { distance: 6, suppressed: true, waitMs: 333 }).impactAtMs).toBe(333);
    expect(planEffect(e, { distance: 6, suppressed: true }).impactAtMs).toBe(planEffect(e, { distance: 6 }).travelMs);
    expect(planEffect(e, { distance: 6, suppressed: true }).travel).toBeUndefined();
  });

  it("travelSuppressed names the earlier effect that travelled", () => {
    const a = fx({ kind: "attack", style: "spell", sourceId: "s", targetId: "t" });
    const b = fx({ kind: "attack", style: "spell", sourceId: "s", targetId: "t", outcome: "hit" });
    expect(travelSuppressed([{ effect: a, receivedAt: 0 }, { effect: b, receivedAt: 300 }]).get(b.id)).toEqual({ byId: a.id, receivedAt: 0 });
  });
});

// Review round 2 (2026-10-18).
describe("review round 2", () => {
  const fx = (id: string, e: Partial<BoardEffect>): BoardEffect => ({ id, kind: "hit", ts: 0, ...e });

  describe(" chained follow-ups", () => {
    it("cast_spell orb → attack roll → apply_damage: the damage does not fly a second orb", () => {
      // Fire Bolt: the cast's orb travels (t=0), the roll lands on it (t=1000, suppressed),
      // the damage follows 700 ms after the roll (t=1700): 1.7 s after the orb, inside the
      // dedupe window of the effect right before it.
      const orb = fx("orb", { kind: "attack", style: "spell", element: "fire", sourceId: "pc_w", targetId: "m1" });
      const roll = fx("roll", { kind: "attack", style: "spell", element: "fire", sourceId: "pc_w", targetId: "m1", outcome: "hit" });
      const dmg = fx("dmg", { kind: "hit", style: "spell", element: "fire", sourceId: "pc_w", targetId: "m1" });
      const sup = travelSuppressed([
        { effect: orb, receivedAt: 0 },
        { effect: roll, receivedAt: 1000 },
        { effect: dmg, receivedAt: 1700 },
      ]);
      expect(sup.has("roll")).toBe(true);
      expect(sup.has("dmg")).toBe(true);
    });

    it("the chain keeps pointing at the effect that travelled (for waitMs)", () => {
      const a = fx("a", { kind: "attack", style: "melee", sourceId: "s", targetId: "t" });
      const b = fx("b", { kind: "attack", style: "melee", sourceId: "s", targetId: "t", outcome: "hit" });
      const c = fx("c", { kind: "hit", style: "melee", sourceId: "s", targetId: "t" });
      const sup = travelSuppressed([{ effect: a, receivedAt: 0 }, { effect: b, receivedAt: 1000 }, { effect: c, receivedAt: 2400 }]);
      expect(sup.get("c")).toEqual({ byId: "a", receivedAt: 0 });
    });
  });
});

describe("reactionPose", () => {
  it("rests at a finite zero pose with no reaction, before impact and after it ends", () => {
    for (const [kind, age] of [[undefined, Infinity], ["hit", Infinity], ["crit", -100], ["hit", REACTION_MS], ["miss", NaN]] as const)
      expect(reactionPose(kind, age)).toEqual({ x: 0, y: 0, flash: 0 });
  });

  it("shakes and flashes on a hit, harder on a crit; a miss sidesteps without a flash", () => {
    const hit = reactionPose("hit", 100);
    const crit = reactionPose("crit", 100);
    const miss = reactionPose("miss", REACTION_MS / 2);
    expect(hit.flash).toBeGreaterThan(0);
    expect(crit.flash).toBeGreaterThan(hit.flash);
    expect(Math.abs(crit.x)).toBeGreaterThan(Math.abs(hit.x));
    expect(miss).toEqual({ x: expect.closeTo(0.28), y: 0, flash: 0 });
    expect(reactionPose("heal", REACTION_MS / 2).y).toBeCloseTo(0.12);
  });
});
