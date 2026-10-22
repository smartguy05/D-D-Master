import { describe, expect, it } from "vitest";
import { Store } from "../db/index.js";
import { GameService, toolOutcome } from "./service.js";

function game() {
  const store = new Store(":memory:");
  const g = new GameService(store, { dmSession: { log: () => undefined, warn: () => undefined } });
  g.hub.broadcast = () => undefined;
  (g as unknown as { images: unknown }).images = { map: async () => "/m/1.png", readAsset: () => undefined, available: false };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  g.createCampaign({ name: "Test" });
  g.addCharacter({ name: "Thorin", maxHp: 12 });
  g.updateOutline({
    title: "T",
    locations: [
      { id: "loc_a", name: "A", mapPrompt: "a nave", gridW: 10, gridH: 8, fog: true },
      { id: "loc_b", name: "B", mapPrompt: "a crypt", gridW: 10, gridH: 8 },
    ],
  });
  const events = (type: string) => store.eventsSince(g.campaign!.id, 0).filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
  return { g, events };
}

describe("session diagnostics", () => {
  it("a tool event carries its outcome: ok with a short result, the refusal, or the thrown error", async () => {
    const { g, events } = game();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("move_party", { to: "nowhere" }, "dm").catch(() => undefined);
    const tools = events("tool");
    expect(tools[0]).toMatchObject({ name: "change_scene", source: "host", ok: true });
    expect(String(tools[0].result)).toMatch(/"location":"A"/);
    expect(tools[1]).toMatchObject({ name: "move_party", ok: false });
    expect(String(tools[1].error)).toMatch(/no features/);
  });

  it("saves the board after a scene change, session log lines and the mic's source as diag events", async () => {
    const { g, events } = game();
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    (g as unknown as { dmSessionOpts: { log: (l: string) => void } }).dmSessionOpts.log("[watch] move: I head to");
    g.setMicMuted(true, undefined, "host-key");
    const diag = events("diag");
    expect(diag.find((d) => d.tag === "board")).toMatchObject({ location: "loc_a", pcs: [expect.stringMatching(/@\d+,\d+$/)] });
    expect(diag.find((d) => d.tag === "watch")).toEqual({ tag: "watch", text: "move: I head to" });
    expect(diag.find((d) => d.tag === "mic")).toMatchObject({ muted: true, source: "host-key" });
  });

  it("toolOutcome keeps results short", () => {
    expect(toolOutcome({ error: "nope" })).toEqual({ ok: false, error: "nope" });
    expect(toolOutcome({ ok: true })).toEqual({ ok: true, result: '{"ok":true}' });
    expect(toolOutcome("x".repeat(400)).result).toHaveLength(301);
  });
});
