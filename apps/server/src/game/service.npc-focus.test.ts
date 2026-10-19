import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

/** A service with stubbed images: outline NPC "Mira Thornwood" has a pre-drawn portrait. */
function game() {
  const g = new GameService(new Store(":memory:"));
  const events: ServerEvent[] = [];
  g.hub.broadcast = (e) => void events.push(e);
  const cachedSprite = (_c: string, subject: string) => (subject.startsWith("Mira Thornwood,") ? "/media/mira.png" : undefined);
  const sprite = vi.fn(async (_c: string, subject: string) => `/media/drawn-${subject.split(",")[0].replace(/\s+/g, "_")}.png`);
  (g as unknown as { images: unknown }).images = { sprite, cachedSprite, map: async () => "/m.png", readAsset: () => undefined, available: true };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  g.createCampaign({ name: "T", partyLevel: 1 });
  g.updateOutline({
    title: "T",
    locations: [
      { id: "loc_a", name: "Inn", gridW: 10, gridH: 8 },
      { id: "loc_b", name: "Road", gridW: 10, gridH: 8 },
    ],
    npcs: [{ name: "Mira Thornwood", description: "a sharp-eyed innkeeper" }],
  });
  const focusEvents = () => events.filter((e) => e.type === "npc_focus" || e.type === "caption");
  return { g, events, focusEvents, sprite };
}

afterEach(() => vi.useRealTimers());

describe("npc_focus (TV close-up)", () => {
  it("focuses an outline NPC by a short name, with its pre-drawn portrait, and clears", async () => {
    const { g, focusEvents } = game();
    expect(await g.runTool("npc_focus", { npc_name: "mira" })).toEqual({ ok: true, focus: "Mira Thornwood" });
    expect(focusEvents().at(-1)).toEqual({ type: "npc_focus", focus: { name: "Mira Thornwood", portraitUrl: "/media/mira.png" } });
    expect(await g.runTool("npc_focus", {})).toEqual({ ok: true, focus: null });
    expect(focusEvents().at(-1)).toEqual({ type: "npc_focus", focus: null });
  });

  it("an NPC token's own sprite wins", async () => {
    const { g, focusEvents } = game();
    await g.runTool("add_npc", { name: "Captain Venn", appearance: "scarred guard captain" });
    g.state!.monsters.find((m) => m.name === "Captain Venn")!.spriteUrl = "/media/venn.png";
    await g.runTool("npc_focus", { npc_name: "Captain Venn" });
    expect(focusEvents().at(-1)).toMatchObject({ focus: { name: "Captain Venn", portraitUrl: "/media/venn.png" } });
  });

  it("matches any part of the name ('Thornwood', 'mira thornwood')", async () => {
    const { g, focusEvents } = game();
    await g.runTool("npc_focus", { npc_name: "Thornwood" });
    expect(focusEvents().at(-1)).toMatchObject({ focus: { name: "Mira Thornwood", portraitUrl: "/media/mira.png" } });
  });

  it("an NPC without a picture yet gets one drawn, and the close-up updates when it's ready", async () => {
    const { g, focusEvents, sprite } = game();
    await g.runTool("npc_focus", { npc_name: "Old Tobble" });
    expect(focusEvents().at(-1)).toEqual({ type: "npc_focus", focus: { name: "Old Tobble" } });
    await vi.waitFor(() => expect(focusEvents().at(-1)).toEqual({ type: "npc_focus", focus: { name: "Old Tobble", portraitUrl: "/media/drawn-Old_Tobble.png" } }));
    expect(sprite).toHaveBeenCalledOnce();
  });

  it("a portrait that arrives after the focus moved on doesn't bring the old NPC back", async () => {
    const { g, focusEvents, sprite } = game();
    let finish!: (url: string) => void;
    sprite.mockImplementationOnce(() => new Promise<string>((r) => (finish = r)));
    await g.runTool("npc_focus", { npc_name: "Old Tobble" });
    await g.runTool("npc_focus", { npc_name: "Mira" });
    finish("/media/tobble.png");
    await new Promise((r) => setTimeout(r, 0));
    expect(focusEvents().at(-1)).toMatchObject({ focus: { name: "Mira Thornwood" } });
  });

  it("is not game state: no undo entry", async () => {
    const { g } = game();
    const before = g.listHistory().length;
    await g.runTool("npc_focus", { npc_name: "Mira" });
    expect(g.listHistory().length).toBe(before);
    expect(JSON.stringify(g.state)).not.toContain("npc_focus");
  });

  it("captions the DM's speech only while focused; a scene change clears the focus", async () => {
    const { g, focusEvents } = game();
    const host = (g as any).dmHost();
    host.onDmCaption("it_1", "The road is long.", true);
    expect(focusEvents()).toHaveLength(0);
    await g.runTool("npc_focus", { npc_name: "Mira" });
    host.onDmCaption("it_2", "Rooms are two silver.", true);
    expect(focusEvents().at(-1)).toEqual({ type: "caption", caption: { id: "it_2", npcName: "Mira Thornwood", text: "Rooms are two silver.", final: true } });
    await g.runTool("change_scene", { location_id: "loc_b" });
    expect(focusEvents().at(-1)).toEqual({ type: "npc_focus", focus: null });
  });

  it("speak_as_npc puts that NPC in the close-up", async () => {
    const { g, focusEvents } = game();
    await g.runTool("speak_as_npc", { npc_name: "Mira Thornwood", line: "Get out." }).catch(() => undefined);
    expect(focusEvents()[0]).toMatchObject({ type: "npc_focus", focus: { name: "Mira Thornwood" } });
  });
});
