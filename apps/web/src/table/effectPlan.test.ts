import { describe, expect, it } from "vitest";
import type { BoardEffect } from "@dm/shared";
import { TRAVEL_DEDUPE_MS, planEffect, travelSuppressed, visualFor } from "./effectPlan";

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
    const darts = planEffect(fx({ kind: "attack", style: "spell", element: "force", sourceId: "a", targetId: "b", count: 3 }), { distance: 6 });
    const one = planEffect(fx({ kind: "attack", style: "spell", element: "force", sourceId: "a", targetId: "b" }), { distance: 6 });
    expect(darts.count).toBe(3);
    expect(darts.impactAtMs).toBeGreaterThan(one.impactAtMs);
    expect(darts.impactAtMs).toBeLessThan(1000);
  });

  it("an attack without a known outcome still lands (a spark), but does not shake as a hit", () => {
    const p = planEffect(fx({ kind: "attack", style: "melee", sourceId: "a", targetId: "b" }), { distance: 1 });
    expect(p.impact).toBe("spark");
    expect(p.reaction).toBeUndefined();
  });

  it("no source position, or a suppressed travel: the landing plays at once", () => {
    const e = fx({ kind: "attack", style: "ranged", sourceId: "a", targetId: "b", outcome: "hit" });
    for (const p of [planEffect(e, {}), planEffect(e, { distance: 5, suppressed: true })]) {
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
    expect([...s]).toEqual([b.id]);
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
