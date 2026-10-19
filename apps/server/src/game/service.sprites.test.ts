import { describe, expect, it, vi } from "vitest";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

/** A service whose image API is stubbed: sprites are cached by subject, and each draw can be held open. */
function game() {
  const g = new GameService(new Store(":memory:"));
  g.hub.broadcast = () => undefined;
  const drawn = new Map<string, string>();
  const pending: Array<() => void> = [];
  let hold = false;
  const sprite = vi.fn(async (campaignId: string, subject: string) => {
    if (hold) await new Promise<void>((r) => pending.push(r));
    const url = `/media/${campaignId}/${drawn.size}.png`;
    drawn.set(`${campaignId}|${subject}`, url);
    return url;
  });
  const cachedSprite = (campaignId: string, subject: string) => drawn.get(`${campaignId}|${subject}`);
  (g as unknown as { images: unknown }).images = { sprite, cachedSprite, map: async () => "/m.png", readAsset: () => undefined, available: true };
  (g as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  const release = () => pending.splice(0).forEach((r) => r());
  return { g, sprite, setHold: (h: boolean) => (hold = h), release };
}

const outline = {
  title: "T",
  locations: [{ id: "loc_a", name: "A", gridW: 10, gridH: 8 }],
  encounters: [
    { id: "e1", locationId: "loc_a", description: "ambush", monsters: [{ name: "shadow wolf", count: 2 }] },
    { id: "e2", locationId: "loc_a", description: "den", monsters: [{ name: "Shadow Wolf", count: 1 }, { name: "bog hag", count: 1 }] },
  ],
};
const subjects = (sprite: ReturnType<typeof game>["sprite"]) => sprite.mock.calls.map((c) => c[1]);

describe("GameService sprite pre-drawing", () => {
  it("draws each outline monster kind once, as soon as the outline exists", async () => {
    const { g, sprite } = game();
    g.createCampaign({ name: "Test" });
    g.updateOutline(outline);
    await vi.waitFor(() => expect(sprite).toHaveBeenCalledTimes(2));
    expect(subjects(sprite)).toEqual([expect.stringMatching(/^Shadow Wolf, a D&D monster/), expect.stringMatching(/^Bog Hag, a D&D monster/)]);
  });

  it("a later spawn uses the pre-drawn sprite without another API call", async () => {
    const { g, sprite } = game();
    g.createCampaign({ name: "Test" });
    g.updateOutline(outline);
    await vi.waitFor(() => expect(sprite).toHaveBeenCalledTimes(2));
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("spawn_monster", { name: "shadow wolf", count: 2 }, "host");
    await vi.waitFor(() => expect(g.state!.monsters.every((m) => m.spriteUrl)).toBe(true));
    expect(sprite).toHaveBeenCalledTimes(2);
  });

  it("a spawn during the pre-draw shares the running draw", async () => {
    const { g, sprite, setHold, release } = game();
    g.createCampaign({ name: "Test" });
    setHold(true);
    g.updateOutline(outline);
    await vi.waitFor(() => expect(sprite).toHaveBeenCalledTimes(1));
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("spawn_monster", { name: "shadow wolf", count: 1 }, "host");
    setHold(false);
    release();
    await vi.waitFor(() => expect(g.state!.monsters[0]!.spriteUrl).toBeTruthy());
    await vi.waitFor(() => expect(sprite).toHaveBeenCalledTimes(2)); // wolf once, then the hag
    expect(subjects(sprite).filter((x) => x.startsWith("Shadow Wolf"))).toHaveLength(1);
  });

  it("loading a campaign redraws a PC sprite that is missing", async () => {
    const { g, sprite } = game();
    const c = g.createCampaign({ name: "Test" });
    const pc = g.addCharacter({ name: "Thorin", maxHp: 12 });
    await vi.waitFor(() => expect(g.state!.characters[0]!.spriteUrl).toBeTruthy());
    g.updateCharacter(pc.id, { spriteUrl: undefined });
    sprite.mockClear();
    g.loadCampaign(c.id);
    await vi.waitFor(() => expect(g.state!.characters[0]!.spriteUrl).toBeTruthy());
    expect(subjects(sprite)).toEqual([expect.stringMatching(/^Thorin, a /)]);
  });

  it("a draw that finishes after the host switched campaigns does not touch the new one", async () => {
    const { g, sprite, setHold, release } = game();
    const first = g.createCampaign({ name: "First" });
    setHold(true);
    g.addCharacter({ name: "Thorin", maxHp: 12 });
    const second = g.createCampaign({ name: "Second" });
    g.addCharacter({ name: "Thorin", maxHp: 12 });
    await vi.waitFor(() => expect(sprite).toHaveBeenCalledTimes(2));
    setHold(false);
    release();
    await Promise.all(sprite.mock.results.map((r) => r.value));
    await new Promise((r) => setTimeout(r, 0));
    expect(g.campaign!.id).toBe(second.id);
    // Same Thorin by name: without the guard, the first campaign's url would land here.
    expect(g.state!.characters[0]!.spriteUrl).toContain(second.id);
    expect(g.store.getState(first.id)!.characters[0]!.spriteUrl).toBeUndefined();
  });
});

describe("GameService NPC sprites", () => {
  it("add_npc draws the NPC's own portrait from its outline look, separate from monsters of its stat block", async () => {
    const { g, sprite } = game();
    g.createCampaign({ name: "Test" });
    g.updateOutline({ ...outline, encounters: [], npcs: [{ name: "Captain Mara Venn", description: "A scarred watch captain in a blue cloak." }] });
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("add_npc", { name: "Captain Mara Venn", stat_block: "Guard" }, "host");
    await vi.waitFor(() => expect(g.state!.monsters[0]!.spriteUrl).toBeTruthy());
    expect(subjects(sprite)).toEqual([expect.stringMatching(/^Captain Mara Venn, a D&D character\. A scarred watch captain in a blue cloak\./)]);
    await g.runTool("spawn_monster", { name: "Guard" }, "host");
    await vi.waitFor(() => expect(g.state!.monsters[1]!.spriteUrl).toBeTruthy());
    expect(g.state!.monsters[1]!.spriteUrl).not.toBe(g.state!.monsters[0]!.spriteUrl);
    expect(subjects(sprite)[1]).toMatch(/^Guard, a D&D monster/);
  });

  it("draws outline NPC portraits up front, before the encounter monsters, and add_npc reuses them", async () => {
    const { g, sprite } = game();
    g.createCampaign({ name: "Test" });
    g.updateOutline({ ...outline, npcs: [{ name: "Captain Mara Venn", description: "A scarred watch captain in a blue cloak." }] });
    await vi.waitFor(() => expect(sprite).toHaveBeenCalledTimes(3));
    expect(subjects(sprite)).toEqual([
      expect.stringMatching(/^Captain Mara Venn, a D&D character\. A scarred watch captain/),
      expect.stringMatching(/^Shadow Wolf, a D&D monster/),
      expect.stringMatching(/^Bog Hag, a D&D monster/),
    ]);
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("add_npc", { name: "captain mara venn", stat_block: "Guard" }, "host");
    await vi.waitFor(() => expect(g.state!.monsters[0]!.spriteUrl).toBeTruthy());
    expect(sprite).toHaveBeenCalledTimes(3);
  });

  it("an add_npc with a new look draws again instead of using the pre-drawn portrait", async () => {
    const { g, sprite } = game();
    g.createCampaign({ name: "Test" });
    g.updateOutline({ ...outline, encounters: [], npcs: [{ name: "Captain Mara Venn", description: "A scarred watch captain." }] });
    await vi.waitFor(() => expect(sprite).toHaveBeenCalledTimes(1));
    await g.runTool("change_scene", { location_id: "loc_a" }, "host");
    await g.runTool("add_npc", { name: "Captain Mara Venn", appearance: "Disguised as a beggar in rags." }, "host");
    await vi.waitFor(() => expect(g.state!.monsters[0]!.spriteUrl).toBeTruthy());
    expect(subjects(sprite)[1]).toMatch(/^Captain Mara Venn, a D&D character\. Disguised as a beggar/);
  });
});
