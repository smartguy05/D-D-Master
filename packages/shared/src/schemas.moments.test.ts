import { describe, expect, it } from "vitest";
import * as shared from "./index.js";
import { Campaign, Combat, GameState, Moment, MomentKind } from "./schemas.js";

describe("Moment schema", () => {
  it("lists the moment kinds", () => {
    expect(MomentKind.options).toEqual(["victory", "defeat", "fled", "death", "revived", "campaign_end", "turn_start", "attitude", "combat_start"]);
  });

  it("accepts a turn_start moment and rejects an unknown kind", () => {
    expect(Moment.parse({ id: "mo_1", kind: "turn_start", targetId: "pc_a", ts: 5 })).toEqual({ id: "mo_1", kind: "turn_start", targetId: "pc_a", ts: 5 });
    expect(() => Moment.parse({ id: "mo_1", kind: "party", ts: 5 })).toThrow();
  });

  it("takes an optional outcome and text (end_campaign's epilogue)", () => {
    const m = Moment.parse({ id: "mo_2", kind: "campaign_end", outcome: "success", text: "The bell rings again.", ts: 1 });
    expect(m).toMatchObject({ outcome: "success", text: "The bell rings again." });
    for (const outcome of ["monster", "rallied", "success", "failure"]) expect(Moment.safeParse({ id: "x", kind: "death", outcome, ts: 1 }).success).toBe(true);
    expect(Moment.safeParse({ id: "x", kind: "death", outcome: "won", ts: 1 }).success).toBe(false);
    expect(() => Moment.parse({ id: "x", kind: "victory" })).toThrow(); // ts is required
  });

  it("is re-exported from the package index", () => {
    expect((shared as Record<string, unknown>).Moment).toBe(Moment);
    expect((shared as Record<string, unknown>).MomentKind).toBe(MomentKind);
  });
});

describe("Campaign status", () => {
  it("an old saved campaign without status parses as active, with no completedAt", () => {
    const c = Campaign.parse({ id: "cmp_old", name: "Old", createdAt: 1, updatedAt: 1 });
    expect(c.status).toBe("active");
    expect(c.completedAt).toBeUndefined();
  });

  it("keeps completed/failed with completedAt and rejects other values", () => {
    expect(Campaign.parse({ id: "c", name: "n", createdAt: 1, updatedAt: 1, status: "completed", completedAt: 9 })).toMatchObject({ status: "completed", completedAt: 9 });
    expect(Campaign.parse({ id: "c", name: "n", createdAt: 1, updatedAt: 1, status: "failed" }).status).toBe("failed");
    expect(Campaign.safeParse({ id: "c", name: "n", createdAt: 1, updatedAt: 1, status: "won" }).success).toBe(false);
  });
});

describe("Combat.announced", () => {
  it("defaults to [] and accepts victory/defeat only", () => {
    expect(Combat.parse({}).announced).toEqual([]);
    expect(Combat.parse({ announced: ["victory", "defeat"] }).announced).toEqual(["victory", "defeat"]);
    expect(Combat.safeParse({ announced: ["fled"] }).success).toBe(false);
  });

  it("an old saved GameState whose combat has no announced parses with []", () => {
    const s = GameState.parse({
      campaignId: "c",
      combat: { active: true, round: 2, turnIndex: 0, order: [{ entityId: "pc", entityType: "character", name: "Mara", initiative: 12 }], turn: null, reactionsUsed: [] },
    });
    expect(s.combat.announced).toEqual([]);
    expect(GameState.parse({ campaignId: "c" }).combat.announced).toEqual([]);
  });
});
