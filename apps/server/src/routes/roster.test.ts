import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import { Store } from "../db/index.js";
import { GameService } from "../game/service.js";
import { registerApi } from "./api.js";
import { registerRosterRoutes } from "./roster.js";

const origDataDir = config.dataDir;
let dataDir = "";
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "dm-roster-routes-"));
  config.dataDir = dataDir;
});
afterEach(() => {
  config.dataDir = origDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

/** Same error handling as index.ts: a thrown error becomes 400 + { error }. */
function withErrors(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 400;
    reply.status(status).send({ error: err.message });
  });
  return app;
}

function build(opts: { campaign?: boolean } = {}) {
  const game = new GameService(new Store(":memory:"));
  game.hub.broadcast = () => undefined;
  (game as unknown as { images: unknown }).images = { sprite: async () => "/x.png", cachedSprite: () => undefined, map: async () => "/m.png", readAsset: () => undefined, available: false };
  if (opts.campaign !== false) game.createCampaign({ name: "A" });
  const app = withErrors(Fastify());
  registerApi(app, game);
  return { app, game };
}

describe("roster routes", () => {
  it("registerRosterRoutes is exported and registerApi already registers it", async () => {
    expect(typeof registerRosterRoutes).toBe("function");
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/api/roster" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /api/roster works with no campaign loaded", async () => {
    const { app } = build({ campaign: false });
    const res = await app.inject({ method: "GET", url: "/api/roster" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("save -> list -> join (new campaign) -> delete", async () => {
    const { app, game } = build();
    const pc = game.addCharacter({ name: "Mara", maxHp: 20, level: 3 } as never);

    const saved = await app.inject({ method: "POST", url: `/api/roster/save/${pc.id}` });
    expect(saved.statusCode).toBe(200);
    const { rosterId, created } = saved.json() as { rosterId: string; created: boolean };
    expect(created).toBe(true);
    expect(rosterId).toMatch(/^ros_/);

    const again = await app.inject({ method: "POST", url: `/api/roster/save/${pc.id}` });
    expect(again.json()).toEqual({ rosterId, created: false });

    const list = await app.inject({ method: "GET", url: "/api/roster" });
    expect(list.json()).toEqual([expect.objectContaining({ id: rosterId, name: "Mara", level: 3, hasVoiceprint: false })]);

    game.createCampaign({ name: "B" });
    const player = game.addPlayer("Kit");
    const joined = await app.inject({ method: "POST", url: `/api/roster/${rosterId}/join`, payload: { playerId: player.id } });
    expect(joined.statusCode).toBe(200);
    const ch = joined.json() as { id: string; name: string; rosterId: string };
    expect(ch).toMatchObject({ name: "Mara", rosterId });
    expect(ch.id).not.toBe(pc.id);
    expect(game.state!.players[0].characterId).toBe(ch.id);

    const del = await app.inject({ method: "DELETE", url: `/api/roster/${rosterId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/api/roster" })).json()).toEqual([]);
  });

  it("POST /api/roster/join works with no body", async () => {
    const { app, game } = build();
    const pc = game.addCharacter({ name: "Mara", maxHp: 20 });
    const { rosterId } = (await app.inject({ method: "POST", url: `/api/roster/save/${pc.id}` })).json() as { rosterId: string };
    game.createCampaign({ name: "B" });
    const joined = await app.inject({ method: "POST", url: `/api/roster/${rosterId}/join` });
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({ name: "Mara", rosterId });
  });

  it("POST /api/roster/save-all saves every character (not captured by /api/roster/:id/...)", async () => {
    const { app, game } = build();
    const a = game.addCharacter({ name: "Mara", maxHp: 20 });
    const b = game.addCharacter({ name: "Bryn", maxHp: 12 });
    const res = await app.inject({ method: "POST", url: "/api/roster/save-all" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { saved: { characterId: string; rosterId: string; created: boolean }[] };
    expect(body.saved.map((s) => s.characterId).sort()).toEqual([a.id, b.id].sort());
    expect(body.saved.every((s) => s.created)).toBe(true);
    expect(((await app.inject({ method: "GET", url: "/api/roster" })).json() as unknown[]).length).toBe(2);
  });

  it("errors answer 400 with { error }", async () => {
    const { app, game } = build();
    const pc = game.addCharacter({ name: "Mara", maxHp: 20 });
    const { rosterId } = (await app.inject({ method: "POST", url: `/api/roster/save/${pc.id}` })).json() as { rosterId: string };

    const unknownJoin = await app.inject({ method: "POST", url: "/api/roster/ros_nope/join", payload: {} });
    expect(unknownJoin.statusCode).toBe(400);
    expect(unknownJoin.json()).toEqual({ error: expect.stringMatching(/Unknown roster character/) });

    // Mara (linked) is already in this campaign: a join of the same hero is a duplicate.
    const dup = await app.inject({ method: "POST", url: `/api/roster/${rosterId}/join`, payload: {} });
    expect(dup.statusCode).toBe(400);
    expect(dup.json()).toEqual({ error: expect.any(String) });

    const unknownSave = await app.inject({ method: "POST", url: "/api/roster/save/pc_nope" });
    expect(unknownSave.statusCode).toBe(400);
    expect(unknownSave.json()).toEqual({ error: expect.stringMatching(/Unknown character/) });

    const unknownDelete = await app.inject({ method: "DELETE", url: "/api/roster/ros_nope" });
    expect(unknownDelete.statusCode).toBe(400);
    expect(unknownDelete.json()).toEqual({ error: expect.stringMatching(/Unknown roster character/) });
  });

  it("save without a loaded campaign answers 400", async () => {
    const { app } = build({ campaign: false });
    const res = await app.inject({ method: "POST", url: "/api/roster/save/pc_x" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
    const all = await app.inject({ method: "POST", url: "/api/roster/save-all" });
    expect(all.statusCode).toBe(400);
  });

  it("registerRosterRoutes alone mounts the five routes", async () => {
    const game = new GameService(new Store(":memory:"));
    game.hub.broadcast = () => undefined;
    const app = withErrors(Fastify());
    registerRosterRoutes(app, game);
    await app.ready();
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toMatch(/roster/);
    expect((await app.inject({ method: "GET", url: "/api/roster" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/roster/save-all" })).statusCode).toBe(400); // no campaign
  });
});

describe("DELETE /api/campaigns/roster", () => {
  it("answers 400 and keeps the roster folder", async () => {
    const { app } = build();
    const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
    mkdirSync(join(dataDir, "roster", "assets"), { recursive: true });
    writeFileSync(join(dataDir, "roster", "assets", "ros_x.png"), "png");
    const res = await app.inject({ method: "DELETE", url: "/api/campaigns/roster" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/reserved for the character roster/);
    expect(existsSync(join(dataDir, "roster", "assets", "ros_x.png"))).toBe(true);
    const load = await app.inject({ method: "POST", url: "/api/campaigns/roster/load" });
    expect(load.statusCode).toBe(400);
  });
});
