import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreationOptions } from "@dm/shared";
import { config } from "../config.js";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

// Per-campaign character constraints (docs/gameplay/character-constraints.md).

const origDataDir = config.dataDir;
let dataDir = "";
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "dm-svc-constraints-"));
  config.dataDir = dataDir;
});
afterEach(() => {
  config.dataDir = origDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

async function setup() {
  const store = new Store(":memory:");
  const game = new GameService(store);
  game.hub.broadcast = () => undefined;
  (game as unknown as { images: unknown }).images = { sprite: async () => "/x.png", cachedSprite: () => undefined, map: async () => "/m.png", readAsset: () => undefined, available: false };
  game.createCampaign({ name: "Rat City" });
  await game.init(); // SRD catalogs (it reloads the newest campaign: ours)
  return { store, game };
}

const RATS = {
  allowedSpecies: [" Sewer Rat ", "sewer rat", "Halfling"],
  allowedClasses: ["Rogue", "Fighter"],
  customSpecies: [{ name: "Sewer Rat", speed: 35, traits: [{ name: "Squeeze", text: "" }] }],
};

const options = (game: GameService) => (game as unknown as { creationOptions(level: number): CreationOptions }).creationOptions(1);

describe("campaign character constraints", () => {
  it("the host saves them cleaned; existing characters are left alone", async () => {
    const { game, store } = await setup();
    const elf = game.addCharacter({ name: "Lia", species: "Elf", className: "Wizard", maxHp: 7 });
    const c = game.updateCampaignSettings({ constraints: RATS });
    expect(c.constraints.allowedSpecies).toEqual(["Sewer Rat", "Halfling"]);
    expect(c.constraints.customSpecies[0]).toMatchObject({ name: "Sewer Rat", speed: 35, creatureType: "Humanoid" });
    expect(store.getCampaign(c.id)!.constraints.allowedClasses).toEqual(["Rogue", "Fighter"]);
    expect(game.state!.characters.find((x) => x.id === elf.id)).toMatchObject({ species: "Elf", className: "Wizard" });
    expect(() => game.updateCampaignSettings({ constraints: { customSpecies: [{ name: "Rat" }, { name: "rat" }] } })).toThrow(/share a name/);
  });

  it("the phone options hold only the allowed species (custom first) and classes", async () => {
    const { game } = await setup();
    expect(options(game).species.some((s) => s.name === "Elf")).toBe(true);
    game.updateCampaignSettings({ constraints: RATS });
    const o = options(game);
    expect(o.species.map((s) => s.name)).toEqual(["Sewer Rat", "Halfling"]);
    expect(o.classes.map((c) => c.name).sort()).toEqual(["Fighter", "Rogue"]);
  });

  it("the voice builder refuses a species that isn't allowed and finalizes an allowed one", async () => {
    const { game } = await setup();
    const sam = game.addPlayer("Sam");
    game.updateCampaignSettings({ constraints: RATS });
    game.startCharacterBuilder(sam.id, 1, "dm");
    expect(() => game.updateCharacterDraft({ species: "Elf" })).toThrow(/Elf isn't allowed/);
    expect(game.state!.builder!.draft.species).toBeUndefined();
    game.updateCharacterDraft({ name: "Pip", species: "Sewer Rat", className: "Rogue", abilities: { str: 8, dex: 15, con: 14, int: 12, wis: 13, cha: 10 } });
    const res = game.finalizeCharacter() as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(game.state!.characters.find((c) => c.name === "Pip")).toMatchObject({ species: "Sewer Rat", speed: 35 });
  });

  it("a sheet import that breaks the rules is refused", async () => {
    const { game } = await setup();
    game.updateCampaignSettings({ constraints: RATS });
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ name: "Lia", species: "Elf", className: "Wizard", maxHp: 7 }));
    (game as unknown as { brain: unknown }).brain = { name: "fake", model: "m", complete };
    await expect(game.importSheet("Lia, elf wizard")).rejects.toThrow(/breaks this campaign's character rules/);
    expect(game.state!.characters.some((c) => c.name === "Lia")).toBe(false);
  });

  it("the host catalog lists every SRD species and class", async () => {
    const { game } = await setup();
    game.updateCampaignSettings({ constraints: RATS });
    const cat = game.originCatalog();
    expect(cat.species).toContain("Elf");
    expect(cat.classes).toContain("Wizard");
  });
});
