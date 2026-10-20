import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Monster, type ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { buildBundle, importBundle } from "./bundle.js";
import { GameService } from "./service.js";

type MomentEvent = { type: "moment"; moment: { id: string; kind: string; targetId?: string; outcome?: string; text?: string; ts: number } };
const isMoment = (e: ServerEvent): e is ServerEvent & MomentEvent => (e as { type: string }).type === "moment";

function setup() {
  const store = new Store(":memory:");
  const game = new GameService(store);
  const events: ServerEvent[] = [];
  game.hub.broadcast = (ev) => void events.push(ev);
  const campaign = game.createCampaign({ name: "Bells" });
  const pc = game.addCharacter({ name: "Mara", maxHp: 12 });
  return { store, game, events, campaign, pc };
}

/** Snapshot sent to a newly connected socket (Hub keeps it private). */
const snapshotOf = (game: GameService) => (game.hub as unknown as { snapshot: () => ServerEvent[] }).snapshot();

/** Run a service tool; an error result or a throw both count as an error. */
async function outcome(p: Promise<unknown>): Promise<{ result?: unknown; error?: unknown }> {
  try {
    const result = await p;
    return result && typeof result === "object" && "error" in result ? { error: (result as { error: unknown }).error } : { result };
  } catch (error) {
    return { error };
  }
}

describe("GameService moment events", () => {
  it("broadcasts moments after the state and effect events: death then victory", async () => {
    const { game, events } = setup();
    game.state!.monsters.push(Monster.parse({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13 }));
    await game.runTool("start_combat", {}, "host");
    events.length = 0;

    await game.runTool("apply_damage", { target_id: "m1", amount: 9 }, "host");
    const types = events.map((e) => e.type as string);
    expect(types).toEqual(["state", "effect", "moment", "moment"]);
    const ms = events.filter(isMoment).map((e) => e.moment);
    expect(ms[0]).toMatchObject({ kind: "death", targetId: "m1", outcome: "monster" });
    expect(ms[1]).toMatchObject({ kind: "victory" });
  });

  it("start_combat broadcasts a turn_start moment", async () => {
    const { game, events } = setup();
    game.state!.monsters.push(Monster.parse({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13 }));
    events.length = 0;
    await game.runTool("start_combat", {}, "dm");
    const turn = events.filter(isMoment).find((e) => e.moment.kind === "turn_start");
    expect(turn?.moment.targetId).toBe(game.state!.combat.order[0].entityId);
    expect(events.findIndex((e) => e.type === "state")).toBeLessThan(events.findIndex(isMoment));
  });

  it("moments are transient: not in the snapshot, the saved state or the event log", async () => {
    const { game, events, store, campaign } = setup();
    game.state!.monsters.push(Monster.parse({ id: "m1", name: "Goblin", maxHp: 7, hp: 7, ac: 13 }));
    await game.runTool("start_combat", {}, "host");
    await game.runTool("apply_damage", { target_id: "m1", amount: 9 }, "host");
    const ids = events.filter(isMoment).map((e) => e.moment.id);
    expect(ids.length).toBeGreaterThan(0);

    expect(snapshotOf(game).some((e) => (e as { type: string }).type === "moment")).toBe(false);
    const saved = JSON.stringify(store.getState(campaign.id));
    const log = JSON.stringify(store.eventsSince(campaign.id, 0));
    const live = JSON.stringify(game.state);
    for (const id of ids) {
      expect(saved).not.toContain(id);
      expect(log).not.toContain(id);
      expect(live).not.toContain(id);
    }
  });

  it("a host HP edit that brings a downed PC back up broadcasts no moment", async () => {
    const { game, events, pc } = setup();
    await game.runTool("apply_damage", { target_id: pc.id, amount: 13 }, "host");
    events.length = 0;
    game.updateCharacter(pc.id, { hp: 5 });
    expect(game.state!.characters[0].hp).toBe(5);
    expect(events.filter(isMoment)).toEqual([]);
  });
});

describe("end_campaign", () => {
  it("completes the campaign, saves and broadcasts it, logs it and plays campaign_end", async () => {
    const { game, events, store, campaign } = setup();
    events.length = 0;
    const before = Date.now();
    const res = await game.runTool("end_campaign", { outcome: "success", epilogue: "The bell rings again." }, "dm");
    expect(res).toMatchObject({ status: "completed" });

    expect(game.campaign?.status).toBe("completed");
    expect(game.campaign?.completedAt).toBeGreaterThanOrEqual(before);
    expect(store.getCampaign(campaign.id)).toMatchObject({ status: "completed" });
    expect(store.getCampaign(campaign.id)?.completedAt).toBe(game.campaign?.completedAt);

    const camp = events.find((e) => e.type === "campaign") as { campaign: { status?: string } } | undefined;
    expect(camp?.campaign.status).toBe("completed");
    const m = events.filter(isMoment).map((e) => e.moment);
    expect(m).toEqual([expect.objectContaining({ kind: "campaign_end", outcome: "success", text: "The bell rings again." })]);
    expect(game.state!.log.some((l) => l.kind === "system" && /success|complete/i.test(l.text))).toBe(true);
  });

  it("a failure marks the campaign failed; the host can call it too", async () => {
    const { game, events, store, campaign } = setup();
    events.length = 0;
    const res = await game.runTool("end_campaign", { outcome: "failure" }, "host");
    expect(res).toMatchObject({ status: "failed" });
    expect(store.getCampaign(campaign.id)?.status).toBe("failed");
    expect(events.filter(isMoment).map((e) => e.moment)).toEqual([expect.objectContaining({ kind: "campaign_end", outcome: "failure" })]);
    expect(game.state!.log.some((l) => l.kind === "system" && /fail/i.test(l.text))).toBe(true);
  });

  it("refuses to end a campaign that is not active, and plays nothing", async () => {
    const { game, events } = setup();
    await game.runTool("end_campaign", { outcome: "success" }, "dm");
    events.length = 0;
    const r = await outcome(game.runTool("end_campaign", { outcome: "failure" }, "dm"));
    expect(r.error).toBeDefined();
    expect(events.filter(isMoment)).toEqual([]);
    expect(game.campaign?.status).toBe("completed");
  });

  it("rejects bad args", async () => {
    const { game, events } = setup();
    events.length = 0;
    const r = await outcome(game.runTool("end_campaign", { outcome: "victory" }, "dm"));
    expect(r.error).toBeDefined();
    expect(events.filter(isMoment)).toEqual([]);
    expect(game.campaign?.status).toBe("active");
  });

  it("resetCampaign reopens a finished campaign", async () => {
    const { game, store, campaign } = setup();
    await game.runTool("end_campaign", { outcome: "success" }, "dm");
    game.resetCampaign(campaign.id, { keepPlayers: true, keepCharacters: true, keepOutline: true });
    const c = store.getCampaign(campaign.id)!;
    expect(c.status).toBe("active");
    expect(c.completedAt).toBeUndefined();
    expect(game.campaign?.status).toBe("active");
  });
});

describe("campaign status in bundles", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("export/import keeps status and completedAt", async () => {
    const { game, store, campaign } = setup();
    await game.runTool("end_campaign", { outcome: "failure" }, "host");
    const dataDir = mkdtempSync(join(tmpdir(), "dm-moments-"));
    dirs.push(dataDir);
    const bundle = buildBundle(store, dataDir, campaign.id);
    const target = new Store(":memory:");
    const imported = importBundle(target, dataDir, bundle, "cmp_new");
    expect(imported.status).toBe("failed");
    expect(target.getCampaign("cmp_new")).toMatchObject({ status: "failed", completedAt: game.campaign?.completedAt });
  });
});
