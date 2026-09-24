import { describe, expect, it } from "vitest";
import { Character, emptyGameState } from "@dm/shared";
import { Store } from "../db/index.js";
import { restoredState, sameState, StateHistory, toolLabel } from "./history.js";
import { GameService } from "./service.js";

function storeWithCampaign(id = "cmp_1") {
  const store = new Store(":memory:");
  store.saveCampaign({ id, name: "T", premise: "", partyLevel: 1, sessionSummaries: [], createdAt: 1, updatedAt: 1 });
  return store;
}

describe("StateHistory", () => {
  it("records snapshots newest-first and bounds them per campaign", () => {
    const store = storeWithCampaign();
    const h = new StateHistory(store, 5);
    for (let v = 0; v < 8; v++) h.record({ ...emptyGameState("cmp_1"), version: v }, `step ${v}`);
    const list = h.list("cmp_1");
    expect(list.map((e) => e.version)).toEqual([7, 6, 5, 4, 3]);
    expect(list[0].label).toBe("step 7");
    expect(h.latest("cmp_1")?.state.version).toBe(7);
    expect(h.get("cmp_1", 5)?.label).toBe("step 5");
    expect(h.get("cmp_1", 1)).toBeUndefined();
  });

  it("truncateFrom drops the entry and everything newer; cascades with the campaign", () => {
    const store = storeWithCampaign();
    const h = new StateHistory(store);
    for (let v = 0; v < 4; v++) h.record({ ...emptyGameState("cmp_1"), version: v }, `s${v}`);
    h.truncateFrom("cmp_1", h.get("cmp_1", 2)!.id);
    expect(h.list("cmp_1").map((e) => e.version)).toEqual([1, 0]);
    store.deleteCampaign("cmp_1");
    expect(h.list("cmp_1")).toEqual([]);
  });

  it("labels tool calls with names instead of ids and clips long labels", () => {
    const s = emptyGameState("c");
    s.characters.push(Character.parse({ id: "pc_a", playerName: "Sam", name: "Thorin", maxHp: 10, hp: 10 }));
    expect(toolLabel("apply_damage", { target_id: "pc_a", amount: 5 }, s)).toBe("apply_damage Thorin amount=5");
    expect(toolLabel("next_turn", {}, s, "host")).toBe("host: next_turn");
    expect(toolLabel("narrate", { text: "x".repeat(300) }).length).toBeLessThanOrEqual(90);
  });

  it("restoredState bumps the version, clears the speaker badge and syncs voice samples", () => {
    const cur = { ...emptyGameState("c"), version: 10 };
    const snap = emptyGameState("c");
    snap.version = 3;
    snap.players.push({ id: "p1", name: "Sam", voiceSamples: 4 }, { id: "p2", name: "Alex", voiceSamples: 0 });
    snap.activeSpeaker = { playerId: "p1", playerName: "Sam", confidence: 1, ts: 1 };
    const out = restoredState(cur, snap, new Map([["p2", 2]]));
    expect(out.version).toBe(11);
    expect(out.activeSpeaker).toBeUndefined();
    expect(out.players.map((p) => p.voiceSamples)).toEqual([0, 2]);
    expect(snap.version).toBe(3); // input untouched
    expect(sameState({ ...cur, version: 1 }, { ...cur, version: 2 })).toBe(true);
  });
});

describe("GameService undo", () => {
  function setup() {
    const game = new GameService(new Store(":memory:"));
    const c = game.createCampaign({ name: "Undo test" });
    game.addCharacter({ name: "Thorin", maxHp: 12 });
    return { game, c, pc: game.state!.characters[0] };
  }

  it("writes a labelled entry per state-changing tool and none for read-only tools", async () => {
    const { game, pc } = setup();
    await game.runTool("apply_damage", { target_id: pc.id, amount: 5 }, "dm");
    await game.runTool("get_party_status", {}, "dm");
    const labels = game.listHistory().map((e) => e.label);
    expect(labels).toEqual(["apply_damage Thorin amount=5", "host edit: add character Thorin"]);
  });

  it("undo restores the whole previous state, logs it, and pops the entry", async () => {
    const { game, pc } = setup();
    await game.runTool("apply_damage", { target_id: pc.id, amount: 5 }, "dm");
    await game.runTool("heal", { target_id: pc.id, amount: 2 }, "host");
    expect(game.state!.characters[0].hp).toBe(9);
    const before = game.state!.version;
    const res = game.undo();
    expect(res.restored.label).toBe("host: heal Thorin amount=2");
    expect(game.state!.characters[0].hp).toBe(7);
    expect(game.state!.version).toBe(before + 1);
    expect(game.state!.log.at(-1)).toMatchObject({ kind: "system", text: "Host undid: host: heal Thorin amount=2" });
    expect(game.listHistory()[0].label).toBe("apply_damage Thorin amount=5");
    game.undo();
    expect(game.state!.characters[0].hp).toBe(12);
  });

  it("restore(version) rewinds several steps at once and persists", async () => {
    const { game, c, pc } = setup();
    await game.runTool("apply_damage", { target_id: pc.id, amount: 1 }, "dm");
    const target = game.listHistory()[0];
    await game.runTool("apply_damage", { target_id: pc.id, amount: 1 }, "dm");
    await game.runTool("apply_damage", { target_id: pc.id, amount: 1 }, "dm");
    game.restoreHistory(target.version);
    expect(game.state!.characters[0].hp).toBe(12);
    expect(game.store.getState(c.id)!.characters[0].hp).toBe(12);
    expect(game.listHistory().map((e) => e.label)).toEqual(["host edit: add character Thorin"]);
    expect(() => game.restoreHistory(9999)).toThrow(/No history entry/);
  });

  it("undo with no history throws", () => {
    const game = new GameService(new Store(":memory:"));
    game.createCampaign({ name: "Empty" });
    expect(() => game.undo()).toThrow(/Nothing to undo/);
  });
});
