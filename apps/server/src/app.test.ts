import { afterEach, describe, expect, it } from "vitest";
import { get as httpsGet } from "node:https";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { Store } from "./db/index.js";
import { GameService } from "./game/service.js";
import { buildApp, createSockets } from "./app.js";
import { loadOrCreateCert } from "./tls.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const port = (app: FastifyInstance) => (app.server.address() as AddressInfo).port;

function httpsJson(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { rejectUnauthorized: false }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
    }).on("error", reject);
  });
}

/** First /ws message after the hello (the hub's snapshot) over a plain or TLS socket. */
function firstMessage(url: string): Promise<{ type: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    // Host and table sockets get their snapshot after the hello (hub.ts viewer tiers).
    ws.once("open", () => ws.send(JSON.stringify({ type: "hello", role: "host" })));
    ws.once("message", (data) => {
      ws.close();
      resolve(JSON.parse(String(data)));
    });
    ws.once("error", reject);
  });
}

describe("buildApp: HTTP and HTTPS listeners over one GameService", { timeout: 30_000 }, () => {
  it("both serve the API and the /ws socket from the same game", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dm-app-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const game = new GameService(new Store(":memory:"));
    game.createCampaign({ name: "Shared" });
    const sockets = createSockets(game);
    const tls = await loadOrCreateCert(dir, { lanIps: [] });
    const plain = await buildApp(game, { sockets });
    const secure = await buildApp(game, { sockets, https: { key: tls.key, cert: tls.cert } });
    cleanup.push(() => plain.close(), () => secure.close());
    await plain.listen({ port: 0, host: "127.0.0.1" });
    await secure.listen({ port: 0, host: "127.0.0.1" });

    const viaHttp = (await (await fetch(`http://127.0.0.1:${port(plain)}/api/status`)).json()) as { campaignId: string };
    const viaHttps = await httpsJson(`https://127.0.0.1:${port(secure)}/api/status`);
    expect(viaHttps.status).toBe(200);
    expect((viaHttps.body as { campaignId: string }).campaignId).toBe(viaHttp.campaignId);
    expect(viaHttp.campaignId).toBe(game.campaign!.id);

    expect((await firstMessage(`ws://127.0.0.1:${port(plain)}/ws`)).type).toBeTruthy();
    expect((await firstMessage(`wss://127.0.0.1:${port(secure)}/ws`)).type).toBeTruthy();
  });

  it("a roster delete over the API answers 400", async () => {
    const game = new GameService(new Store(":memory:"));
    const app = await buildApp(game);
    cleanup.push(() => app.close());
    const res = await app.inject({ method: "DELETE", url: "/api/campaigns/roster" });
    expect(res.statusCode).toBe(400);
  });
});
