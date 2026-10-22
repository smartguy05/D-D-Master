import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { GameState, Monster, type ServerEvent } from "@dm/shared";
import { Store } from "./db/index.js";
import { GameService } from "./game/service.js";
import { buildApp } from "./app.js";
import { Auth } from "./auth/index.js";
import { AuthStore } from "./auth/store.js";
import { FailureLimiter } from "./auth/ratelimit.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const REMOTE = { "cf-connecting-ip": "203.0.113.9" };
const CODE = "WOLF-1234";

async function setup(over: Partial<ConstructorParameters<typeof Auth>[0]> = {}) {
  const game = new GameService(new Store(":memory:"));
  game.createCampaign({ name: "Online" });
  const ana = game.addPlayer("Ana");
  const bo = game.addPlayer("Bo");
  const auth = new Auth({ store: new AuthStore({ envCode: CODE }), hostPassword: "hunter2", trustLan: true, hostLocalBypass: true, publicUrl: "", ...over });
  const app = await buildApp(game, { auth });
  cleanup.push(() => app.close());
  return { game, app, auth, ana: ana.id as string, bo: bo.id as string };
}

/** The dm_auth cookie a response set ("dm_auth=…"), for the next request's Cookie header. */
function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const c = (Array.isArray(raw) ? raw : [raw]).find((x) => typeof x === "string" && x.startsWith("dm_auth="));
  if (!c) throw new Error("no auth cookie set");
  return (c as string).split(";")[0];
}

async function joinAndClaim(app: FastifyInstance, playerId: string, ip = "203.0.113.9") {
  const joined = await app.inject({ method: "POST", url: "/api/auth/join", headers: { "cf-connecting-ip": ip }, payload: { code: CODE } });
  expect(joined.statusCode).toBe(200);
  const claimed = await app.inject({ method: "POST", url: "/api/auth/claim", headers: { "cf-connecting-ip": ip, cookie: cookieOf(joined) }, payload: { playerId } });
  return { joined, claimed, cookie: claimed.statusCode === 200 ? cookieOf(claimed) : cookieOf(joined) };
}

describe("HTTP access (auth/access.ts via the onRequest hook)", () => {
  it("a tunnelled request without a cookie gets 401 on host routes; this machine is the host", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/campaigns", headers: REMOTE });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBeTruthy();
    expect((await app.inject({ method: "GET", url: "/api/campaigns" })).statusCode).toBe(200);
  });

  it("join -> claim: the player reaches its own seat's routes, not another seat's nor host routes", async () => {
    const { app, ana, bo } = await setup();
    const { claimed, cookie } = await joinAndClaim(app, ana);
    expect(claimed.statusCode).toBe(200);
    const h = { ...REMOTE, cookie };
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/players/${bo}/notes`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: h })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/players/${ana}/enroll/start`, headers: h })).statusCode).toBe(401);
    const me = (await app.inject({ method: "GET", url: "/api/auth/me", headers: h })).json();
    expect(me).toMatchObject({ level: "player", playerId: ana });
  });

  it("a joined player without a seat yet sees the human seats but no seat routes", async () => {
    const { app, game, ana } = await setup();
    const ai = game.addPlayer("Bot", { ai: true });
    const joined = await app.inject({ method: "POST", url: "/api/auth/join", headers: REMOTE, payload: { code: "wolf 1234" } });
    expect(joined.statusCode).toBe(200);
    const h = { ...REMOTE, cookie: cookieOf(joined) };
    const seats = (await app.inject({ method: "GET", url: "/api/auth/claim", headers: h })).json().seats as { id: string }[];
    expect(seats.map((s) => s.id)).toContain(ana);
    expect(seats.map((s) => s.id)).not.toContain(ai.id);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/auth/claim", headers: h, payload: { playerId: ai.id } })).statusCode).toBe(400);
  });

  it("a wrong code is 401; ten wrong tries lock the IP out (429) even for the right code", async () => {
    const { app } = await setup({ limiter: new FailureLimiter({ max: 10, windowMs: 600_000 }) });
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/join", headers: REMOTE, payload: { code: `NOPE-${i}` } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: "POST", url: "/api/auth/join", headers: REMOTE, payload: { code: CODE } });
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await app.inject({ method: "POST", url: "/api/auth/join", headers: { "cf-connecting-ip": "198.51.100.1" }, payload: { code: CODE } })).statusCode).toBe(200);
  });

  // A LAN device (home or guest Wi-Fi) only gets table access, so it might guess HOST_PASSWORD; its
  // own forwarding headers must not give it a fresh address for every guess.
  it("a LAN device rotating CF-Connecting-IP is still limited by its own address", async () => {
    const { app } = await setup({ limiter: new FailureLimiter({ max: 10, windowMs: 600_000 }) });
    const lan = { remoteAddress: "192.168.1.50" };
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/host", headers: { "cf-connecting-ip": `198.51.100.${i}` }, payload: { password: "nope" }, ...lan });
      expect(r.statusCode).toBe(401);
    }
    const r = await app.inject({ method: "POST", url: "/api/auth/host", headers: { "cf-connecting-ip": "198.51.100.99" }, payload: { password: "hunter2" }, ...lan });
    expect(r.statusCode).toBe(429);
  });

  it("IPv6 callers through the tunnel are limited per /64", async () => {
    const { app } = await setup({ limiter: new FailureLimiter({ max: 10, windowMs: 600_000 }) });
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/join", headers: { "cf-connecting-ip": `2001:db8:1:1::${(i + 1).toString(16)}` }, payload: { code: `NOPE-${i}` } });
      expect(r.statusCode).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/api/auth/join", headers: { "cf-connecting-ip": "2001:db8:1:1::ff" }, payload: { code: CODE } })).statusCode).toBe(429);
    expect((await app.inject({ method: "POST", url: "/api/auth/join", headers: { "cf-connecting-ip": "2001:db8:1:2::1" }, payload: { code: CODE } })).statusCode).toBe(200);
  });

  it("many addresses guessing together hit the global budget", async () => {
    const { app } = await setup({ limiter: new FailureLimiter({ max: 10, globalMax: 20, windowMs: 600_000, warn: () => undefined }) });
    for (let i = 0; i < 20; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/join", headers: { "cf-connecting-ip": `198.51.100.${i}` }, payload: { code: `NOPE-${i}` } });
      expect(r.statusCode).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/api/auth/join", headers: { "cf-connecting-ip": "203.0.113.200" }, payload: { code: CODE } })).statusCode).toBe(429);
  });

  it("a seat whose holder has been gone longer than the grace time can be taken over", async () => {
    const { app, ana } = await setup({ seatGraceMs: 0 });
    const first = await joinAndClaim(app, ana, "203.0.113.1");
    expect(first.claimed.statusCode).toBe(200);
    // Same player, new browser (cookies cleared, in-app browser -> Safari): no socket is open for Ana.
    const second = await joinAndClaim(app, ana, "203.0.113.1");
    expect(second.claimed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { ...REMOTE, cookie: second.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { ...REMOTE, cookie: first.cookie } })).statusCode).toBe(401);
  });

  it("TRUSTED_HOSTS lets a LAN device use a router DNS name (fritz.box) without losing TRUST_LAN", async () => {
    const { app, ana } = await setup({ trustedHosts: ["fritz.box"] });
    const res = await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { host: "gamebox.fritz.box:8787" }, remoteAddress: "192.168.1.7" });
    expect(res.statusCode).toBe(200);
    const other = await setup();
    expect((await other.app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { host: "gamebox.fritz.box:8787" }, remoteAddress: "192.168.1.7" })).statusCode).toBe(401);
  });

  it("a seat taken by another device is refused until the host kicks it", async () => {
    const { app, ana } = await setup();
    const first = await joinAndClaim(app, ana, "203.0.113.1");
    expect(first.claimed.statusCode).toBe(200);
    const second = await joinAndClaim(app, ana, "203.0.113.2");
    expect(second.claimed.statusCode).toBe(409);
    // The host (this machine) frees the seat: the first device's cookie stops working.
    const kick = await app.inject({ method: "POST", url: "/api/auth/kick", payload: { playerId: ana } });
    expect(kick.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { ...REMOTE, cookie: first.cookie } })).statusCode).toBe(401);
    const retry = await app.inject({ method: "POST", url: "/api/auth/claim", headers: { ...REMOTE, cookie: second.cookie }, payload: { playerId: ana } });
    expect(retry.statusCode).toBe(200);
  });

  it("rotating the code logs every player out and changes the code", async () => {
    const { app, ana } = await setup({ store: new AuthStore({}) });
    const sessions = (await app.inject({ method: "GET", url: "/api/auth/sessions" })).json();
    const join = await app.inject({ method: "POST", url: "/api/auth/join", headers: REMOTE, payload: { code: sessions.code } });
    const claim = await app.inject({ method: "POST", url: "/api/auth/claim", headers: { ...REMOTE, cookie: cookieOf(join) }, payload: { playerId: ana } });
    const cookie = cookieOf(claim);
    const rotated = await app.inject({ method: "POST", url: "/api/auth/code/rotate" });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().code).not.toBe(sessions.code);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { ...REMOTE, cookie } })).statusCode).toBe(401);
  });

  it("rotate refuses a fixed TABLE_CODE; players can't rotate, kick or list sessions", async () => {
    const { app, ana } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/auth/code/rotate" })).statusCode).toBe(400);
    const { cookie } = await joinAndClaim(app, ana);
    const h = { ...REMOTE, cookie };
    expect((await app.inject({ method: "POST", url: "/api/auth/code/rotate", headers: h })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/kick", headers: h, payload: { playerId: ana } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: h })).statusCode).toBe(401);
  });

  it("the host password sets a host cookie; wrong is 401; no HOST_PASSWORD means no remote host", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "nope" } })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "hunter2" } });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: { ...REMOTE, cookie: cookieOf(ok) } })).statusCode).toBe(200);

    const off = await setup({ hostPassword: "" });
    const r = await off.app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "" } });
    expect(r.statusCode).toBe(403);
  });

  it("the cookie is Secure behind an https proxy (x-forwarded-proto) and HttpOnly + SameSite=Lax", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/auth/join", headers: { ...REMOTE, "x-forwarded-proto": "https" }, payload: { code: CODE } });
    const set = String(res.headers["set-cookie"]);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Secure/);
    const plain = await app.inject({ method: "POST", url: "/api/auth/join", headers: REMOTE, payload: { code: CODE } });
    expect(String(plain.headers["set-cookie"])).not.toMatch(/Secure/);
  });

  it("logout frees the seat and clears the cookie", async () => {
    const { app, ana } = await setup();
    const { cookie } = await joinAndClaim(app, ana);
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { ...REMOTE, cookie } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { ...REMOTE, cookie } })).statusCode).toBe(401);
    expect((await joinAndClaim(app, ana, "203.0.113.50")).claimed.statusCode).toBe(200);
  });

  it("a player may only type to the DM as its own seat", async () => {
    const { app, ana, bo } = await setup();
    const { cookie } = await joinAndClaim(app, ana);
    const h = { ...REMOTE, cookie };
    expect((await app.inject({ method: "POST", url: "/api/dm/say", headers: h, payload: { text: "hi", playerId: bo } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/dm/say", headers: h, payload: { text: "hi" } })).statusCode).toBe(403);
    // Allowed through (no DM is running in the test, so the service answers 400 "not running").
    const own = await app.inject({ method: "POST", url: "/api/dm/say", headers: h, payload: { text: "hi", playerId: ana } });
    expect(own.statusCode).toBe(400);
    expect(own.json().error).not.toMatch(/own character/);
  });

  it("a phone's roll answers players with the total only (no target AC, hints or next turn); the host gets the tool result", async () => {
    const { app, game, ana } = await setup();
    game.addCharacter({ name: "Lyra", className: "Wizard", level: 1, maxHp: 7 }, ana);
    const { cookie } = await joinAndClaim(app, ana);
    const asPlayer = await app.inject({ method: "POST", url: `/api/players/${ana}/roll`, headers: { ...REMOTE, cookie }, payload: { notation: "1d20", label: "Stealth" } });
    expect(asPlayer.statusCode).toBe(200);
    expect(Object.keys(asPlayer.json()).sort()).toEqual(["dmInformed", "ok", "total"]);
    const asHost = await app.inject({ method: "POST", url: `/api/players/${ana}/roll`, payload: { notation: "1d20", label: "Stealth" } });
    expect(asHost.json()).toHaveProperty("dice");
  });

  it("the LAN gets table routes and any seat with TRUST_LAN, but not host routes", async () => {
    const { app, ana } = await setup();
    const lan = { remoteAddress: "192.168.1.7" };
    expect((await app.inject({ method: "POST", url: "/api/mic", payload: { muted: false }, ...lan })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, ...lan })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/campaigns", ...lan })).statusCode).toBe(401);
    const strict = await setup({ trustLan: false });
    expect((await strict.app.inject({ method: "POST", url: "/api/mic", payload: { muted: false }, ...lan })).statusCode).toBe(401);
  });

  it("the push-to-talk toggle is a host route", async () => {
    const { app, game } = await setup();
    game.setPushToTalk(true);
    const lan = { remoteAddress: "192.168.1.7" };
    expect((await app.inject({ method: "POST", url: "/api/push-to-talk", payload: { on: false }, ...lan })).statusCode).toBe(401);
    expect(game.floorView().pushToTalk).toBe(true);
    const res = await app.inject({ method: "POST", url: "/api/push-to-talk", payload: { on: false } });
    expect(res.json()).toEqual({ pushToTalk: false });
    expect(game.floorView().pushToTalk).toBe(false);
  });

  it("refuses a cross-site POST even from this machine (CSRF against the local bypass)", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/dm/stop", headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/dm/stop", headers: { origin: "http://localhost:80" } })).statusCode).toBe(200);
  });

  it("serves the ICE servers to players", async () => {
    const { app, ana } = await setup();
    const { cookie } = await joinAndClaim(app, ana);
    const res = await app.inject({ method: "GET", url: "/api/rtc/config", headers: { ...REMOTE, cookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().iceServers)).toBe(true);
  });

  it("the host's session list shows seats, claims and connections", async () => {
    const { app, ana, bo } = await setup();
    await joinAndClaim(app, ana);
    const s = (await app.inject({ method: "GET", url: "/api/auth/sessions" })).json();
    expect(s).toMatchObject({ code: CODE, fixedCode: true, hostLogin: true, trustLan: true, onlineUrl: "" });
    const online = await setup({ onlineUrl: "https://dnd.example.com" });
    expect((await online.app.inject({ method: "GET", url: "/api/auth/sessions" })).json().onlineUrl).toBe("https://dnd.example.com");
    const seats = s.seats as { playerId: string; claimed: boolean; connected: number }[];
    expect(seats.find((x) => x.playerId === ana)).toMatchObject({ claimed: true, connected: 0 });
    expect(seats.find((x) => x.playerId === bo)).toMatchObject({ claimed: false });
  });
});

describe("WebSocket upgrades", { timeout: 20_000 }, () => {
  async function listening(over: Partial<ConstructorParameters<typeof Auth>[0]> = {}) {
    const ctx = await setup(over);
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    return { ...ctx, url: `ws://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}` };
  }

  /** Resolves "open" or the refused upgrade's HTTP status. */
  function tryOpen(url: string, headers: Record<string, string>): Promise<{ ws?: WebSocket; status?: number }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.once("open", () => resolve({ ws }));
      ws.once("unexpected-response", (_req, res) => resolve({ status: res.statusCode }));
      ws.once("error", () => resolve({ status: -1 }));
    });
  }

  it("refuses /ws from a remote origin without a cookie (401) and a cross-site Origin (403)", async () => {
    const { url } = await listening();
    expect((await tryOpen(`${url}/ws`, REMOTE)).status).toBe(401);
    expect((await tryOpen(`${url}/ws`, { origin: "https://evil.example" })).status).toBe(403);
    const local = await tryOpen(`${url}/ws`, {});
    expect(local.ws).toBeDefined();
    local.ws!.close();
  });

  it("a player's socket can't claim host in its hello, and /ws/audio needs the table", async () => {
    const { url, app, game, ana } = await listening();
    const { cookie } = await joinAndClaim(app, ana);
    const { ws } = await tryOpen(`${url}/ws`, { ...REMOTE, cookie });
    expect(ws).toBeDefined();
    cleanup.push(() => ws!.close());
    ws!.send(JSON.stringify({ type: "hello", role: "host" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(game.hub.withRole("host")).toHaveLength(0);
    expect(game.hub.withRole("player")).toHaveLength(1);
    expect((await tryOpen(`${url}/ws/audio`, { ...REMOTE, cookie })).status).toBe(401);
    // Kicking the seat closes its socket.
    const closed = new Promise<number>((r) => ws!.once("close", (code) => r(code)));
    await app.inject({ method: "POST", url: "/api/auth/kick", payload: { playerId: ana } });
    expect(await closed).toBe(4401);
  });

  it("/ws/audio: the table mic for the LAN, the host's enrollment mic (?role=host) only for the host", async () => {
    const { url } = await listening();
    const lan = { "x-forwarded-for": "192.168.1.7" };
    const table = await tryOpen(`${url}/ws/audio`, lan);
    expect(table.ws).toBeDefined();
    table.ws!.close();
    expect((await tryOpen(`${url}/ws/audio?role=host`, lan)).status).toBe(401);
    expect((await tryOpen(`${url}/ws/audio?x=1&role=host`, lan)).status).toBe(401);
    const host = await tryOpen(`${url}/ws/audio?role=host`, {});
    expect(host.ws).toBeDefined();
    host.ws!.close();
  });

  it("a seat with an open socket can't be taken over, even past the grace time", async () => {
    const { url, app, ana } = await listening({ seatGraceMs: 0 });
    const { cookie } = await joinAndClaim(app, ana, "203.0.113.1");
    const { ws } = await tryOpen(`${url}/ws`, { ...REMOTE, cookie });
    expect(ws).toBeDefined();
    cleanup.push(() => ws!.close());
    await new Promise((r) => setTimeout(r, 50));
    expect((await joinAndClaim(app, ana, "203.0.113.2")).claimed.statusCode).toBe(409);
  });

  it("a remote player's socket gets the public state, this machine's host socket the full one", async () => {
    const { url, app, game, ana } = await listening();
    const { cookie } = await joinAndClaim(app, ana);
    const collect = (ws: WebSocket) => {
      const got: ServerEvent[] = [];
      ws.on("message", (d) => got.push(JSON.parse(String(d))));
      return got;
    };
    const player = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie })).ws!;
    const host = (await tryOpen(`${url}/ws`, {})).ws!;
    cleanup.push(() => player.close(), () => host.close());
    const fromPlayer = collect(player);
    const fromHost = collect(host);
    player.send(JSON.stringify({ type: "hello", role: "player" }));
    host.send(JSON.stringify({ type: "hello", role: "host" }));
    await new Promise((r) => setTimeout(r, 100));
    const state = GameState.parse({ ...game.state, monsters: [Monster.parse({ id: "m_amb", name: "Ambusher", maxHp: 9, hp: 9, hidden: true })] });
    game.hub.broadcast({ type: "state", state });
    game.hub.broadcast({ type: "job", id: "j", label: "Painting the lair", status: "running", startedAt: 0 });
    await new Promise((r) => setTimeout(r, 100));
    const last = (got: ServerEvent[]) => (got.filter((e) => e.type === "state").at(-1) as { state: GameState }).state;
    expect(last(fromHost).monsters.map((m) => m.name)).toEqual(["Ambusher"]);
    expect(last(fromPlayer).monsters).toEqual([]);
    expect(JSON.stringify(fromPlayer)).not.toContain("Ambusher");
    expect(fromPlayer.some((e) => e.type === "job")).toBe(false);
    expect(fromHost.some((e) => e.type === "job")).toBe(true);
  });

  it("a remote player's push-to-talk presses only for its own seat, and the floor reaches it", async () => {
    const { url, app, game, ana, bo } = await listening();
    game.setPushToTalk(true);
    const { cookie } = await joinAndClaim(app, ana);
    const player = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie })).ws!;
    cleanup.push(() => player.close());
    const got: ServerEvent[] = [];
    player.on("message", (d) => got.push(JSON.parse(String(d))));
    player.send(JSON.stringify({ type: "hello", role: "player" }));
    player.send(JSON.stringify({ type: "ptt", down: true, playerId: bo }));
    await new Promise((r) => setTimeout(r, 100));
    expect(game.floorView().holder).toBeNull();
    player.send(JSON.stringify({ type: "ptt", down: true, playerId: ana }));
    await new Promise((r) => setTimeout(r, 100));
    expect(game.floorView().holder).toEqual({ playerId: ana, inRoom: false });
    expect(got.filter((e) => e.type === "floor").at(-1)).toEqual({ type: "floor", floor: { pushToTalk: true, holder: { playerId: ana, inRoom: false } } });
  });

  it("a seat whose socket just closed stays held for the grace time, then can be taken over", async () => {
    let skew = 0;
    // The claim itself looks 10 min old, so only the socket's close time can keep the seat held.
    const store = new AuthStore({ envCode: CODE, now: () => Date.now() - 600_000 });
    const { url, app, ana } = await listening({ store, seatGraceMs: 60_000, now: () => Date.now() + skew });
    const { cookie } = await joinAndClaim(app, ana, "203.0.113.1");
    const { ws } = await tryOpen(`${url}/ws`, { ...REMOTE, cookie });
    expect(ws).toBeDefined();
    const closed = new Promise((r) => ws!.once("close", r));
    ws!.close();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    skew = 30_000;
    expect((await joinAndClaim(app, ana, "203.0.113.2")).claimed.statusCode).toBe(409);
    skew = 61_000;
    expect((await joinAndClaim(app, ana, "203.0.113.3")).claimed.statusCode).toBe(200);
  });
});
