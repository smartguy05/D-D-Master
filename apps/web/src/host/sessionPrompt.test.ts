import { describe, expect, it } from "vitest";
import { Campaign } from "@dm/shared";
import { endSessionPrompt } from "./sessionPrompt";

const campaign = (status: "active" | "completed" | "failed", extra: Partial<Campaign> = {}) =>
  Campaign.parse({ id: "cmp_1", name: "A", createdAt: 1, updatedAt: 1, status, ...extra });

describe("endSessionPrompt", () => {
  it("never for an active campaign or none", () => {
    expect(endSessionPrompt(null, true)).toBe(false);
    expect(endSessionPrompt(campaign("active"), true)).toBe(false);
  });

  it("while the DM is still live after the campaign ends (success or failure)", () => {
    expect(endSessionPrompt(campaign("completed", { completedAt: 100 }), true)).toBe(true);
    expect(endSessionPrompt(campaign("failed", { completedAt: 100 }), true)).toBe(true);
  });

  it("with the DM stopped, until a recap is written after the ending", () => {
    expect(endSessionPrompt(campaign("completed", { completedAt: 100 }), false)).toBe(true);
    expect(endSessionPrompt(campaign("completed", { completedAt: 100, sessionSummaries: [{ ts: 50, summary: "old" }] }), false)).toBe(true);
    expect(endSessionPrompt(campaign("completed", { completedAt: 100, sessionSummaries: [{ ts: 150, summary: "end" }] }), false)).toBe(false);
  });

  it("an old save without completedAt prompts only while the DM is live", () => {
    expect(endSessionPrompt(campaign("failed"), false)).toBe(false);
    expect(endSessionPrompt(campaign("failed"), true)).toBe(true);
  });
});
