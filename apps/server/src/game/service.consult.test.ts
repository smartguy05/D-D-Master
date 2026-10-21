import { describe, expect, it, vi } from "vitest";
import { Store } from "../db/index.js";
import type { LLMProvider } from "../brain/provider.js";
import { CONSULT_FALLBACK, GameService } from "./service.js";

/** A game with a campaign and a stub consult planner. */
function setup(complete: LLMProvider["complete"] | undefined) {
  const game = new GameService(new Store(":memory:"));
  game.hub.broadcast = () => undefined;
  (game as unknown as { consultLlm: LLMProvider | undefined }).consultLlm = complete ? { name: "stub", model: "stub", complete } : undefined;
  game.createCampaign({ name: "A" });
  return game;
}

describe("consult_brain (CONSULT_TIMEOUT_MS)", () => {
  it("returns the planner's answer", async () => {
    const complete = vi.fn(async () => "The cultists flee north.");
    const game = setup(complete);
    expect(await game.runTool("consult_brain", { question: "What now?" })).toBe("The cultists flee north.");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("a planner timeout becomes an improvise result for the DM, not a thrown error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const game = setup(async () => {
      throw new Error("Brain request timed out after 30s.");
    });
    const out = await game.runTool("consult_brain", { question: "What now?" });
    expect(out).toBe(CONSULT_FALLBACK);
    expect(String(out)).toMatch(/took too long; improvise from the outline and carry on/);
    warn.mockRestore();
  });

  it("without a planner, tells the DM to improvise", async () => {
    const game = setup(undefined);
    expect(String(await game.runTool("consult_brain", { question: "?" }))).toMatch(/No planner available/);
  });
});
