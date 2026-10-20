import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Character, type ServerEvent } from "@dm/shared";
import { config } from "../config.js";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";
import { snapshotForRoster } from "./roster.js";

/* ---------- types for the not-yet-existing API (RED) ---------- */

type Row = { id: string; name: string; data: Character; createdAt: number; updatedAt: number };
type RosterStore = Store & {
  listRoster(): Row[];
  getRoster(id: string): Row | undefined;
  saveRoster(id: string, name: string, data: Character): void;
  deleteRoster(id: string): void;
  getRosterVoiceprint(id: string): { embedding: Float32Array; samples: number } | undefined;
  saveRosterVoiceprint(id: string, embedding: Float32Array, samples: number): void;
};
type Entry = { id: string; name: string; playerName: string; className: string; subclass: string; level: number; species: string; spriteUrl?: string; hasVoiceprint: boolean; updatedAt: number };
type RosterGame = GameService & {
  saveToRoster(characterId: string): { rosterId: string; created: boolean };
  saveAllToRoster(): { saved: { characterId: string; rosterId: string; created: boolean }[] };
  joinFromRoster(rosterId: string, playerId?: string): Character;
  listRoster(): Entry[];
  deleteRoster(id: string): void;
};
type PC = Character & { rosterId?: string };

/* ---------- setup ---------- */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const origDataDir = config.dataDir;
let dataDir = "";
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "dm-svc-roster-"));
  config.dataDir = dataDir;
});
afterEach(() => {
  config.dataDir = origDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function stubImages(game: GameService, available = false) {
  const sprite = vi.fn(async (campaignId: string) => {
    const file = `sprite_${Math.random().toString(36).slice(2)}.png`;
    mkdirSync(join(dataDir, campaignId, "assets"), { recursive: true });
    writeFileSync(join(dataDir, campaignId, "assets", file), PNG);
    return `/media/${campaignId}/${file}`;
  });
  (game as unknown as { images: unknown }).images = { sprite, cachedSprite: () => undefined, map: async () => "/m.png", readAsset: () => undefined, available };
  (game as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  return sprite;
}

function setup(opts: { images?: boolean } = {}) {
  const store = new Store(":memory:") as RosterStore;
  const game = new GameService(store) as RosterGame;
  const events: ServerEvent[] = [];
  game.hub.broadcast = (ev) => void events.push(ev);
  const sprite = stubImages(game, opts.images ?? false);
  const campaign = game.createCampaign({ name: "A" });
  return { store, game, events, campaign, sprite };
}

/** Mara: level 5, 120 gold, a magic item, features; linked to player Sam. */
function addMara(game: RosterGame) {
  const sam = game.addPlayer("Sam");
  const pc = game.addCharacter(
    {
      name: "Mara",
      species: "Human",
      className: "Fighter",
      subclass: "Champion",
      level: 5,
      maxHp: 44,
      gold: 120,
      features: ["Second Wind", "Action Surge", "Extra Attack"],
      inventory: [
        { id: "it_ring", name: "Ring of Protection", qty: 1, description: "+1 AC" },
        { id: "it_rope", name: "Rope", qty: 1 },
      ],
    } as never,
    sam.id,
  );
  return { sam, pc };
}

/** Put a sprite file on disk for a character and point its spriteUrl at it. */
function giveSprite(game: RosterGame, characterId: string, file = "sprite_mara.png") {
  const c = game.campaign!.id;
  mkdirSync(join(dataDir, c, "assets"), { recursive: true });
  writeFileSync(join(dataDir, c, "assets", file), PNG);
  game.updateCharacter(characterId, { spriteUrl: `/media/${c}/${file}` });
}

const pcOf = (game: GameService, id: string) => game.state!.characters.find((c) => c.id === id) as PC | undefined;
const tick = () => new Promise((r) => setTimeout(r, 5));

/* ---------- saveToRoster ---------- */

describe("GameService.saveToRoster", () => {
  it("throws without a loaded campaign and for an unknown character", () => {
    const store = new Store(":memory:");
    const game = new GameService(store) as RosterGame;
    game.hub.broadcast = () => undefined;
    expect(() => game.saveToRoster("pc_x")).toThrow();
    const { game: g2 } = setup();
    expect(() => g2.saveToRoster("pc_missing")).toThrow(/Unknown character/);
  });

  it("creates a roster row and links rosterId with a committed, broadcast, persisted change and no undo entry", () => {
    const { game, store, events, campaign } = setup();
    const { pc } = addMara(game);
    const historyBefore = game.listHistory().length;
    const versionBefore = game.state!.version;
    events.length = 0;

    const res = game.saveToRoster(pc.id);
    expect(res.created).toBe(true);
    expect(res.rosterId).toMatch(/^ros_/);

    const row = store.getRoster(res.rosterId)!;
    expect(row).toBeDefined();
    expect(row.name).toBe("Mara");
    expect((row.data as PC).rosterId).toBe(res.rosterId);
    expect(row.data.level).toBe(5);
    expect(row.data.gold).toBe(120);

    expect(pcOf(game, pc.id)?.rosterId).toBe(res.rosterId);
    expect(game.state!.version).toBeGreaterThan(versionBefore);
    const stateEv = events.filter((e) => e.type === "state") as { state: { characters: PC[] } }[];
    expect(stateEv.at(-1)?.state.characters.find((c) => c.id === pc.id)?.rosterId).toBe(res.rosterId);
    expect((store.getState(campaign.id)!.characters.find((c) => c.id === pc.id) as PC).rosterId).toBe(res.rosterId);
    expect(game.listHistory().length).toBe(historyBefore);
  });

  it("the stored snapshot is snapshotForRoster(character) with rosterId", () => {
    const { game, store } = setup();
    const { pc } = addMara(game);
    game.updateCharacter(pc.id, { hp: 3, conditions: ["poisoned"], tempHp: 2 });
    const { rosterId } = game.saveToRoster(pc.id);
    const live = pcOf(game, pc.id)!;
    const expected = snapshotForRoster({ ...structuredClone(live), rosterId } as Character);
    const data = store.getRoster(rosterId)!.data;
    expect(data.hp).toBe(44);
    expect(data.conditions).toEqual([]);
    expect(data.tempHp).toBe(0);
    // Portrait/item-icon handling may rewrite those two; everything else is the snapshot.
    const strip = (c: Character) => ({ ...c, spriteUrl: undefined, inventory: c.inventory.map((i) => ({ ...i, iconUrl: undefined })) });
    expect(strip(data)).toEqual(strip(expected));
  });

  it("a second save upserts the same row with the current level/gold/inventory", async () => {
    const { game, store } = setup();
    const { pc } = addMara(game);
    const first = game.saveToRoster(pc.id);
    const before = store.getRoster(first.rosterId)!;
    await tick();
    game.updateCharacter(pc.id, { level: 6, gold: 300, inventory: [...pcOf(game, pc.id)!.inventory, { id: "it_new", name: "Flame Tongue", qty: 1 }] });
    const second = game.saveToRoster(pc.id);
    expect(second).toEqual({ rosterId: first.rosterId, created: false });
    expect(store.listRoster()).toHaveLength(1);
    const after = store.getRoster(first.rosterId)!;
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.data.level).toBe(6);
    expect(after.data.gold).toBe(300);
    expect(after.data.inventory.map((i) => i.name)).toContain("Flame Tongue");
  });

  it("recreates a deleted roster row under the same id", () => {
    const { game, store } = setup();
    const { pc } = addMara(game);
    const { rosterId } = game.saveToRoster(pc.id);
    store.deleteRoster(rosterId);
    const again = game.saveToRoster(pc.id);
    expect(again.rosterId).toBe(rosterId);
    expect(store.getRoster(rosterId)?.name).toBe("Mara");
    expect(store.listRoster()).toHaveLength(1);
  });

  it("copies the sprite to <dataDir>/roster/assets and stores /media/roster/<id>.png", () => {
    const { game, store, campaign } = setup();
    const { pc } = addMara(game);
    giveSprite(game, pc.id);
    const { rosterId } = game.saveToRoster(pc.id);
    expect(store.getRoster(rosterId)!.data.spriteUrl).toMatch(new RegExp(`^/media/roster/${rosterId}\\.png\\?v=[0-9a-f]{12}$`));
    expect(readFileSync(join(dataDir, "roster", "assets", `${rosterId}.png`))).toEqual(PNG);
    expect(game.listRoster()[0].spriteUrl).toMatch(new RegExp(`^/media/roster/${rosterId}\\.png\\?v=[0-9a-f]{12}$`));
    // The campaign character keeps its campaign sprite.
    expect(pcOf(game, pc.id)?.spriteUrl).toBe(`/media/${campaign.id}/sprite_mara.png`);
  });

  it("without a sprite file, keeps the previous roster portrait or leaves spriteUrl undefined", () => {
    const { game, store } = setup();
    const { pc } = addMara(game);
    game.updateCharacter(pc.id, { spriteUrl: `/media/${game.campaign!.id}/missing.png` });
    const { rosterId } = game.saveToRoster(pc.id);
    expect(store.getRoster(rosterId)!.data.spriteUrl).toBeUndefined();

    giveSprite(game, pc.id);
    game.saveToRoster(pc.id);
    rmSync(join(dataDir, game.campaign!.id), { recursive: true, force: true });
    game.saveToRoster(pc.id);
    expect(store.getRoster(rosterId)!.data.spriteUrl).toMatch(new RegExp(`^/media/roster/${rosterId}\\.png\\?v=[0-9a-f]{12}$`));
    expect(existsSync(join(dataDir, "roster", "assets", `${rosterId}.png`))).toBe(true);
  });

  it("clears item iconUrls in the stored snapshot (they are campaign-scoped)", () => {
    const { game, store, campaign } = setup();
    const { pc } = addMara(game);
    const inv = pcOf(game, pc.id)!.inventory.map((i) => ({ ...i, iconUrl: `/media/${campaign.id}/item_x.png` }));
    game.updateCharacter(pc.id, { inventory: inv });
    const { rosterId } = game.saveToRoster(pc.id);
    const data = store.getRoster(rosterId)!.data;
    expect(data.inventory.map((i) => i.name)).toEqual(["Ring of Protection", "Rope"]);
    expect(data.inventory.every((i) => i.iconUrl === undefined)).toBe(true);
  });
});

describe("saveToRoster voiceprint", () => {
  it("copies the player's campaign voiceprint to the roster (replacing an older one)", () => {
    const { game, store, campaign } = setup();
    const { sam, pc } = addMara(game);
    store.saveVoiceprint(campaign.id, sam.id, Float32Array.from([0.5, -1, 2]), 4);
    const { rosterId } = game.saveToRoster(pc.id);
    const vp = store.getRosterVoiceprint(rosterId)!;
    expect(Array.from(vp.embedding)).toEqual([0.5, -1, 2]);
    expect(vp.samples).toBe(4);

    store.saveVoiceprint(campaign.id, sam.id, Float32Array.from([3, 3, 3]), 6);
    game.saveToRoster(pc.id);
    const vp2 = store.getRosterVoiceprint(rosterId)!;
    expect(Array.from(vp2.embedding)).toEqual([3, 3, 3]);
    expect(vp2.samples).toBe(6);
  });

  it("without a campaign voiceprint, an existing roster voiceprint is kept and none is created", () => {
    const { game, store } = setup();
    const { pc } = addMara(game);
    const { rosterId } = game.saveToRoster(pc.id);
    expect(store.getRosterVoiceprint(rosterId)).toBeUndefined();
    store.saveRosterVoiceprint(rosterId, Float32Array.from([7, 8]), 2);
    game.saveToRoster(pc.id);
    expect(Array.from(store.getRosterVoiceprint(rosterId)!.embedding)).toEqual([7, 8]);
  });

  it("a character with no player creates no roster voiceprint", () => {
    const { game, store, campaign } = setup();
    const lone = game.addCharacter({ name: "Lone", maxHp: 8 });
    store.saveVoiceprint(campaign.id, "plr_other", Float32Array.from([1]), 1);
    const { rosterId } = game.saveToRoster(lone.id);
    expect(store.getRosterVoiceprint(rosterId)).toBeUndefined();
  });
});

describe("GameService.saveAllToRoster", () => {
  it("saves every character, linked and unlinked", () => {
    const { game, store } = setup();
    const { pc } = addMara(game);
    const lone = game.addCharacter({ name: "Lone", maxHp: 8 });
    const first = game.saveToRoster(pc.id);
    const res = game.saveAllToRoster();
    expect(res.saved).toHaveLength(2);
    expect(res.saved).toEqual(
      expect.arrayContaining([
        { characterId: pc.id, rosterId: first.rosterId, created: false },
        expect.objectContaining({ characterId: lone.id, created: true }),
      ]),
    );
    expect(store.listRoster()).toHaveLength(2);
    expect(game.state!.characters.every((c) => (c as PC).rosterId)).toBe(true);
  });
});

/* ---------- joinFromRoster ---------- */

/** Campaign A with Mara saved to the roster, then campaign B loaded. */
function rosterThenNewCampaign(opts: { images?: boolean; voice?: boolean; sprite?: boolean } = {}) {
  const ctx = setup(opts);
  const { game, store, campaign } = ctx;
  const { sam, pc } = addMara(game);
  if (opts.voice) store.saveVoiceprint(campaign.id, sam.id, Float32Array.from([0.25, 0.5, -0.75]), 5);
  if (opts.sprite) giveSprite(game, pc.id);
  const { rosterId } = game.saveToRoster(pc.id);
  const b = game.createCampaign({ name: "B" });
  return { ...ctx, rosterId, a: campaign, b, sourceId: pc.id };
}

describe("GameService.joinFromRoster", () => {
  it("throws for an unknown roster id and without a loaded campaign", () => {
    const { game } = rosterThenNewCampaign();
    expect(() => game.joinFromRoster("ros_missing")).toThrow(/Unknown roster character/);
    const bare = new GameService(game.store) as RosterGame;
    bare.hub.broadcast = () => undefined;
    const id = (game.store as RosterStore).listRoster()[0].id;
    expect(() => bare.joinFromRoster(id)).toThrow();
  });

  it("adds a fresh copy with a new id, linked rosterId and the same build", () => {
    const { game, rosterId, sourceId } = rosterThenNewCampaign();
    const ch = game.joinFromRoster(rosterId) as PC;
    expect(ch.id).toMatch(/^pc_/);
    expect(ch.id).not.toBe(rosterId);
    expect(ch.id).not.toBe(sourceId);
    expect(ch.rosterId).toBe(rosterId);
    expect(ch).toMatchObject({ name: "Mara", level: 5, gold: 120, subclass: "Champion", className: "Fighter", hp: 44, maxHp: 44 });
    expect(ch.features).toEqual(expect.arrayContaining(["Second Wind", "Action Surge", "Extra Attack"]));
    expect(ch.inventory.map((i) => i.name)).toEqual(["Ring of Protection", "Rope"]);
    const live = pcOf(game, ch.id)!;
    expect(live.rosterId).toBe(rosterId);
    expect(game.state!.tokens.some((t) => t.entityId === ch.id)).toBe(true);
  });

  it("inventory item ids are unique within the campaign", () => {
    const { game, rosterId, store } = rosterThenNewCampaign();
    // A second roster hero carrying the same item ids.
    const twin = snapshotForRoster(store.getRoster(rosterId)!.data);
    store.saveRoster("ros_twin", "Twin", { ...twin, name: "Twin", playerName: "Tess", rosterId: "ros_twin" } as Character);
    game.joinFromRoster(rosterId);
    game.joinFromRoster("ros_twin");
    const ids = game.state!.characters.flatMap((c) => c.inventory.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses a second join of the same roster hero, leaving state unchanged", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    game.joinFromRoster(rosterId);
    const before = structuredClone(game.state);
    expect(() => game.joinFromRoster(rosterId)).toThrow();
    expect(game.state).toEqual(before);
  });

  it("is undoable with the label 'host edit: join from roster Mara'", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    const ch = game.joinFromRoster(rosterId);
    expect(game.listHistory()[0]?.label).toBe("host edit: join from roster Mara");
    game.undo();
    expect(pcOf(game, ch.id)).toBeUndefined();
  });

  it("refreshes the DM instructions", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    const refresh = vi.fn();
    (game as unknown as { dm: unknown }).dm = { refreshInstructions: refresh, isOpen: false, addSystemNote: vi.fn() };
    game.joinFromRoster(rosterId);
    expect(refresh).toHaveBeenCalled();
  });
});

describe("joinFromRoster player linking", () => {
  it("links the given player", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    const kit = game.addPlayer("Kit");
    const ch = game.joinFromRoster(rosterId, kit.id);
    expect(game.state!.players.find((p) => p.id === kit.id)?.characterId).toBe(ch.id);
    expect(pcOf(game, ch.id)?.playerName).toBe("Kit");
    expect(game.state!.players).toHaveLength(1);
  });

  it("throws 'Unknown player' for a missing playerId", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    expect(() => game.joinFromRoster(rosterId, "plr_nope")).toThrow(/Unknown player/);
    expect(game.state!.characters).toHaveLength(0);
  });

  it("throws when the given player already plays a live character", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    const kit = game.addPlayer("Kit");
    game.addCharacter({ name: "Other", maxHp: 5 }, kit.id);
    expect(() => game.joinFromRoster(rosterId, kit.id)).toThrow();
    expect(game.state!.characters.map((c) => c.name)).toEqual(["Other"]);
  });

  it("without playerId, reuses a same-name player (case-insensitive, trimmed) with no live character", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    const sam = game.addPlayer("  sAM ");
    const ch = game.joinFromRoster(rosterId);
    expect(game.state!.players).toHaveLength(1);
    expect(game.state!.players[0].id).toBe(sam.id);
    expect(game.state!.players[0].characterId).toBe(ch.id);
  });

  it("without playerId, throws when the same-name player already plays another character", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    const sam = game.addPlayer("Sam");
    game.addCharacter({ name: "Other", maxHp: 5 }, sam.id);
    expect(() => game.joinFromRoster(rosterId)).toThrow(/player/i);
    expect(game.state!.players).toHaveLength(1);
    expect(game.state!.characters).toHaveLength(1);
  });

  it("without playerId and no match, creates one Player named after playerName and links it", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    const ch = game.joinFromRoster(rosterId);
    expect(game.state!.players).toHaveLength(1);
    expect(game.state!.players[0]).toMatchObject({ name: "Sam", characterId: ch.id, voiceSamples: 0 });
    expect(pcOf(game, ch.id)?.playerName).toBe("Sam");
  });

  it("an empty playerName creates a player named after the character", () => {
    const { game, store } = rosterThenNewCampaign();
    store.saveRoster("ros_np", "Wisp", Character.parse({ id: "pc_w", playerName: "", name: "Wisp", maxHp: 6, hp: 6, rosterId: "ros_np" } as never));
    const ch = game.joinFromRoster("ros_np");
    expect(game.state!.players.find((p) => p.characterId === ch.id)?.name).toBe("Wisp");
  });
});

describe("joinFromRoster voiceprint", () => {
  it("copies the roster voiceprint into this campaign so identify sees the player at once", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign({ voice: true });
    const ch = game.joinFromRoster(rosterId);
    const player = game.state!.players.find((p) => p.characterId === ch.id)!;
    expect(player.voiceSamples).toBe(5);
    const vps = store.getVoiceprints(b.id);
    expect(vps).toHaveLength(1);
    expect(vps[0].playerId).toBe(player.id);
    expect(Array.from(vps[0].embedding)).toEqual([0.25, 0.5, -0.75]);
    expect(vps[0].samples).toBe(5);
  });

  it("keeps a player's existing campaign voiceprint unchanged", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign({ voice: true });
    const kit = game.addPlayer("Kit");
    store.saveVoiceprint(b.id, kit.id, Float32Array.from([9, 9, 9]), 2);
    game.joinFromRoster(rosterId, kit.id);
    const vps = store.getVoiceprints(b.id);
    expect(vps).toHaveLength(1);
    expect(Array.from(vps[0].embedding)).toEqual([9, 9, 9]);
    expect(vps[0].samples).toBe(2);
  });

  it("undoing a join that created a player removes the copied voiceprint; joining again leaves one row", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign({ voice: true });
    game.joinFromRoster(rosterId);
    game.undo();
    expect(store.getVoiceprints(b.id)).toEqual([]);
    const ch = game.joinFromRoster(rosterId);
    const player = game.state!.players.find((p) => p.characterId === ch.id)!;
    const vps = store.getVoiceprints(b.id);
    expect(vps.map((v) => v.playerId)).toEqual([player.id]);
  });

  it("rewinding past a join (restoreHistory) also removes the copied voiceprint", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign({ voice: true });
    game.joinFromRoster(rosterId);
    game.addPlayer("Later");
    const joinEntry = game.listHistory().find((h) => h.label === "host edit: join from roster Mara")!;
    game.restoreHistory(joinEntry.version);
    expect(store.getVoiceprints(b.id)).toEqual([]);
  });

  it("undoing a join that reused a player without a voiceprint removes the roster voiceprint from them", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign({ voice: true });
    const kit = game.addPlayer("Kit");
    game.joinFromRoster(rosterId, kit.id);
    expect(store.getVoiceprints(b.id)).toHaveLength(1);
    game.undo();
    expect(store.getVoiceprints(b.id)).toEqual([]);
    expect(game.state!.players.find((p) => p.id === kit.id)?.voiceSamples).toBe(0);
  });

  it("undoing a join keeps a reused player's own earlier voiceprint", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign({ voice: true });
    const kit = game.addPlayer("Kit");
    store.saveVoiceprint(b.id, kit.id, Float32Array.from([9, 9, 9]), 2);
    game.joinFromRoster(rosterId, kit.id);
    game.undo();
    const vps = store.getVoiceprints(b.id);
    expect(vps).toHaveLength(1);
    expect(Array.from(vps[0].embedding)).toEqual([9, 9, 9]);
  });

  it("a join drops orphan voiceprint rows left for players no longer in the campaign", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign({ voice: true });
    store.saveVoiceprint(b.id, "plr_gone", Float32Array.from([0.25, 0.5, -0.75]), 5);
    const ch = game.joinFromRoster(rosterId);
    const player = game.state!.players.find((p) => p.characterId === ch.id)!;
    expect(store.getVoiceprints(b.id).map((v) => v.playerId)).toEqual([player.id]);
  });

  it("no roster voiceprint: nothing is written", () => {
    const { game, store, rosterId, b } = rosterThenNewCampaign();
    const ch = game.joinFromRoster(rosterId);
    expect(store.getVoiceprints(b.id)).toEqual([]);
    expect(game.state!.players.find((p) => p.characterId === ch.id)?.voiceSamples).toBe(0);
  });
});

describe("joinFromRoster portrait", () => {
  it("copies the roster portrait into the new campaign's assets", () => {
    const { game, rosterId, b, sprite } = rosterThenNewCampaign({ sprite: true });
    const ch = game.joinFromRoster(rosterId);
    expect(ch.spriteUrl).toMatch(new RegExp(`^/media/${b.id}/[\\w.-]+\\.png$`));
    const file = ch.spriteUrl!.split("/").pop()!;
    expect(readFileSync(join(dataDir, b.id, "assets", file))).toEqual(PNG);
    expect(sprite).not.toHaveBeenCalled();
  });

  it("without a roster portrait, spriteUrl is undefined and a sprite draw starts (images available)", async () => {
    const { game, rosterId, sprite } = rosterThenNewCampaign({ images: false });
    (game as unknown as { images: { available: boolean } }).images.available = true;
    const ch = game.joinFromRoster(rosterId);
    expect(ch.spriteUrl).toBeUndefined();
    await vi.waitFor(() => expect(sprite).toHaveBeenCalled());
    await vi.waitFor(() => expect(pcOf(game, ch.id)?.spriteUrl).toBeTruthy());
  });

  it("without a roster portrait and no image API, does not throw", () => {
    const { game, rosterId } = rosterThenNewCampaign();
    expect(() => game.joinFromRoster(rosterId)).not.toThrow();
  });
});

/* ---------- list / delete ---------- */

describe("GameService.listRoster / deleteRoster", () => {
  it("lists newest first with hasVoiceprint, with no campaign loaded", async () => {
    const { game, store, campaign } = setup();
    const { pc } = addMara(game);
    const { sam } = { sam: game.state!.players[0] };
    store.saveVoiceprint(campaign.id, sam.id, Float32Array.from([1, 2]), 2);
    const m = game.saveToRoster(pc.id);
    await tick();
    const lone = game.addCharacter({ name: "Lone", maxHp: 8 });
    const l = game.saveToRoster(lone.id);
    game.deleteCampaign(campaign.id);
    expect(game.campaign).toBeFalsy();

    const list = game.listRoster();
    expect(list.map((e) => e.id)).toEqual([l.rosterId, m.rosterId]);
    expect(list.find((e) => e.id === m.rosterId)).toMatchObject({ name: "Mara", level: 5, className: "Fighter", subclass: "Champion", playerName: "Sam", hasVoiceprint: true });
    expect(list.find((e) => e.id === l.rosterId)?.hasVoiceprint).toBe(false);
  });

  it("deleteRoster throws for an unknown id", () => {
    const { game } = setup();
    expect(() => game.deleteRoster("ros_missing")).toThrow(/Unknown roster character/);
  });

  it("deleteRoster removes the row, its voiceprint and its portrait; linked characters keep rosterId and re-save under it", () => {
    const { game, store, campaign } = setup();
    const { sam, pc } = addMara(game);
    store.saveVoiceprint(campaign.id, sam.id, Float32Array.from([1, 2]), 2);
    giveSprite(game, pc.id);
    const { rosterId } = game.saveToRoster(pc.id);
    expect(existsSync(join(dataDir, "roster", "assets", `${rosterId}.png`))).toBe(true);

    game.deleteRoster(rosterId);
    expect(store.getRoster(rosterId)).toBeUndefined();
    expect(store.getRosterVoiceprint(rosterId)).toBeUndefined();
    expect(existsSync(join(dataDir, "roster", "assets", `${rosterId}.png`))).toBe(false);
    expect(game.listRoster()).toEqual([]);
    expect(pcOf(game, pc.id)?.rosterId).toBe(rosterId);

    const again = game.saveToRoster(pc.id);
    expect(again.rosterId).toBe(rosterId);
    expect(game.listRoster().map((e) => e.id)).toEqual([rosterId]);
  });
});

/* ---------- full round trip ---------- */

describe("roster round trip", () => {
  it("campaign A -> roster -> delete A -> campaign B join keeps level, gold, items, HP and voiceprint", () => {
    const { game, store, campaign: a } = setup();
    const { sam, pc } = addMara(game);
    const emb = Float32Array.from([0.1, 0.2, 0.3, -0.4]);
    store.saveVoiceprint(a.id, sam.id, emb, 6);
    game.updateCharacter(pc.id, { hp: 10 });

    const { rosterId } = game.saveToRoster(pc.id);
    game.deleteCampaign(a.id);
    expect(game.listRoster().map((e) => e.id)).toEqual([rosterId]);

    const b = game.createCampaign({ name: "B" });
    const mara = game.joinFromRoster(rosterId) as PC;
    expect(mara.id).not.toBe(pc.id);
    expect(mara.rosterId).toBe(rosterId);
    expect(mara).toMatchObject({ name: "Mara", level: 5, gold: 120, hp: 44, maxHp: 44 });
    expect(mara.inventory.map((i) => i.name)).toContain("Ring of Protection");

    const player = game.state!.players.find((p) => p.characterId === mara.id)!;
    expect(player).toBeDefined();
    expect(player.voiceSamples).toBeGreaterThan(0);
    const vp = store.getVoiceprints(b.id).find((v) => v.playerId === player.id)!;
    expect(Array.from(vp.embedding)).toEqual(Array.from(emb));
  });
});
