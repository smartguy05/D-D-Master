import { describe, expect, it } from "vitest";
import { Character, emptyGameState, type GameState } from "@dm/shared";
import { Store } from "../db/index.js";
import { resetState } from "./reset.js";
import { GameService } from "./service.js";

function played(): GameState {
  const s = emptyGameState("cmp_1");
  s.version = 41;
  s.locationId = "loc_cave";
  s.players.push({ id: "pl_1", name: "Sam", characterId: "pc_a", voiceSamples: 3, ai: false, aiPersona: "", aiPaused: false });
  s.characters.push(
    Character.parse({
      id: "pc_a",
      playerName: "Sam",
      name: "Thorin",
      level: 3,
      maxHp: 20,
      hp: 0,
      tempHp: 4,
      conditions: ["Unconscious", "Exhaustion 2"],
      gold: 12,
      inventory: [{ id: "it_1", name: "Rope", qty: 1 }],
      spellSlots: [{ level: 1, max: 2, used: 2 }],
      resources: [{ name: "Second Wind", max: 1, used: 1, resetOn: "short" }],
      hitDice: { die: 10, max: 3, used: 2 },
      deathSaves: { successes: 1, failures: 3, stable: false },
      concentration: { spell: "Bless", since: 1 },
    }),
  );
  s.monsters.push({ id: "m_1" } as any);
  s.tokens.push({ id: "pc_a", x: 1, y: 1 } as any);
  s.combat = { ...s.combat, active: true, round: 4 } as any;
  s.log.push({ id: "l1", ts: 1, kind: "system", text: "x" } as any);
  s.fog = { loc_cave: { enabled: true, revealed: ["1,1"], hidden: [] } };
  return s;
}

describe("resetState", () => {
  it("keeps players and characters, restoring downed/dead PCs to fresh", () => {
    const s = resetState(played(), { keepPlayers: true, keepCharacters: true });
    expect(s.version).toBe(42);
    expect(s.players).toEqual([{ id: "pl_1", name: "Sam", characterId: "pc_a", voiceSamples: 3, ai: false, aiPersona: "", aiPaused: false }]);
    const c = s.characters[0];
    expect(c).toMatchObject({ hp: 20, tempHp: 0, conditions: [], concentration: null, level: 3, gold: 12 });
    expect(c.deathSaves).toMatchObject({ successes: 0, failures: 0, stable: false });
    expect(c.spellSlots[0].used).toBe(0);
    expect(c.resources[0].used).toBe(0);
    expect(c.hitDice.used).toBe(0);
    expect(c.inventory.map((i) => i.name)).toEqual(["Rope"]);
  });

  it("always clears the board, combat, log, fog and location", () => {
    const s = resetState(played(), { keepPlayers: true, keepCharacters: true });
    expect(s.monsters).toEqual([]);
    expect(s.tokens).toEqual([]);
    expect(s.combat).toEqual(emptyGameState("x").combat);
    expect(s.log).toEqual([]);
    expect(s.rolls).toEqual([]);
    expect(s.fog).toEqual({});
    expect(s.locationId).toBeUndefined();
    expect(s.campaignId).toBe("cmp_1");
  });

  it("drops characters but keeps players unassigned", () => {
    const s = resetState(played(), { keepPlayers: true, keepCharacters: false });
    expect(s.characters).toEqual([]);
    expect(s.players[0].characterId).toBeUndefined();
    expect(s.players[0].voiceSamples).toBe(3);
  });

  it("drops players but keeps characters", () => {
    const s = resetState(played(), { keepPlayers: false, keepCharacters: true });
    expect(s.players).toEqual([]);
    expect(s.characters.map((c) => c.name)).toEqual(["Thorin"]);
  });

  it("does not modify its input", () => {
    const before = played();
    const copy = structuredClone(before);
    resetState(before, { keepPlayers: true, keepCharacters: true });
    expect(before).toEqual(copy);
  });
});

describe("GameService.resetCampaign", () => {
  function setup() {
    const store = new Store(":memory:");
    const game = new GameService(store);
    const c = game.createCampaign({ name: "Reset test" });
    game.addCharacter({ name: "Thorin", maxHp: 12 });
    const pc = game.state!.characters[0];
    return { store, game, c, pc };
  }

  it("clears history, events and session summaries; keeps the outline when asked", async () => {
    const { store, game, c, pc } = setup();
    await game.runTool("apply_damage", { target_id: pc.id, amount: 5 }, "dm");
    expect(game.listHistory().length).toBeGreaterThan(0);
    store.appendEvent(c.id, "log", { text: "hi" });
    game.campaign!.outline = { title: "T" } as any;
    game.campaign!.sessionSummaries = [{ ts: 1, summary: "s" }];
    store.saveCampaign(game.campaign!);

    game.resetCampaign(c.id, { keepOutline: true, keepPlayers: true, keepCharacters: true });

    expect(game.listHistory()).toEqual([]);
    expect(store.eventsSince(c.id, 0)).toEqual([]);
    expect(game.campaign!.sessionSummaries).toEqual([]);
    expect(game.campaign!.outline).toBeDefined();
    expect(game.state!.characters[0].hp).toBe(12);
  });

  it("drops the outline, voiceprints and player notes when not kept", () => {
    const { store, game, c } = setup();
    game.campaign!.outline = { title: "T" } as any;
    store.saveCampaign(game.campaign!);
    store.saveVoiceprint(c.id, "pl_1", new Float32Array([1, 2]), 1);
    store.savePlayerNotes(c.id, "pl_1", "secret");

    game.resetCampaign(c.id, { keepOutline: false, keepPlayers: false, keepCharacters: false });

    expect(game.campaign!.outline).toBeUndefined();
    expect(store.getCampaign(c.id)!.outline).toBeUndefined();
    expect(store.getVoiceprints(c.id)).toEqual([]);
    expect(store.getPlayerNotes(c.id, "pl_1")).toBeUndefined();
    expect(game.state!.characters).toEqual([]);
  });

  it("resets a campaign that is not loaded without switching to it", () => {
    const { store, game, c } = setup();
    const other = game.createCampaign({ name: "Other" });
    game.resetCampaign(c.id, { keepOutline: true, keepPlayers: true, keepCharacters: false });
    expect(game.campaign!.id).toBe(other.id);
    expect(store.getState(c.id)!.characters).toEqual([]);
  });
});

describe("GameService.resetCampaign: starting location", () => {
  function setup() {
    const store = new Store(":memory:");
    const game = new GameService(store);
    game.hub.broadcast = () => undefined;
    (game as unknown as { images: unknown }).images = { map: async () => "/m.png", sprite: async () => "/s.png", cachedSprite: () => undefined, readAsset: () => undefined, available: true };
    (game as unknown as { readFeatures: unknown }).readFeatures = async () => [];
    const c = game.createCampaign({ name: "Reset test" });
    game.addCharacter({ name: "Thorin", maxHp: 12 });
    game.updateOutline({
      title: "T",
      locations: [
        { id: "loc_gate", name: "Gate", gridW: 10, gridH: 8 },
        { id: "loc_hall", name: "Hall", gridW: 10, gridH: 8 },
      ],
    });
    return { store, game, c };
  }

  it("places the party at the outline's first location when the outline is kept", async () => {
    const { game, c } = setup();
    await game.runTool("change_scene", { location_id: "loc_hall" }, "host");
    game.resetCampaign(c.id, { keepOutline: true, keepPlayers: true, keepCharacters: true });
    expect(game.state!.locationId).toBe("loc_gate");
    const pc = game.state!.characters[0]!;
    expect(game.state!.tokens.some((t) => t.entityId === pc.id)).toBe(true);
  });

  it("the starting location is saved, so a reload keeps it", () => {
    const { store, game, c } = setup();
    game.resetCampaign(c.id, { keepOutline: true, keepPlayers: true, keepCharacters: true });
    expect(store.getState(c.id)!.locationId).toBe("loc_gate");
  });

  it("loads no location when the outline is dropped", () => {
    const { game, c } = setup();
    game.resetCampaign(c.id, { keepOutline: false, keepPlayers: true, keepCharacters: true });
    expect(game.state!.locationId).toBeUndefined();
    expect(game.state!.tokens).toEqual([]);
  });
});

describe("resetState keeps the roster link", () => {
  it("keepCharacters keeps each character's rosterId", () => {
    const s = played();
    (s.characters[0] as Record<string, unknown>).rosterId = "ros_thorin";
    const parsed = Character.parse(s.characters[0]) as Character & { rosterId?: string };
    expect(parsed.rosterId).toBe("ros_thorin"); // the schema keeps it
    s.characters[0] = parsed;
    const next = resetState(s, { keepPlayers: true, keepCharacters: true });
    expect((next.characters[0] as Character & { rosterId?: string }).rosterId).toBe("ros_thorin");
  });
});
