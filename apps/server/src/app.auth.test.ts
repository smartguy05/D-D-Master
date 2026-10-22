import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { GameState, Monster, SAY_MAX, type ServerEvent } from "@dm/shared";
import { Store } from "./db/index.js";
import { GameService } from "./game/service.js";
import { buildApp } from "./app.js";
import { Auth } from "./auth/index.js";
import { AuthStore } from "./auth/store.js";
import { FailureLimiter } from "./auth/ratelimit.js";
import { WS_RECONNECT, type HubSocket } from "./hub.js";

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

  it("phone creation routes are seat routes: a player reads and joins the roster only for its own seat", async () => {
    const { app, ana, bo } = await setup();
    const { cookie } = await joinAndClaim(app, ana);
    const h = { ...REMOTE, cookie };
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/roster`, headers: h })).json()).toEqual({ roster: [] });
    expect((await app.inject({ method: "GET", url: `/api/players/${bo}/roster`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/players/${bo}/roster/ros_x/join`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/roster", headers: h })).statusCode).toBe(401);
    // The draft: own seat only; approving is the host's.
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/creation`, headers: h })).json().draft).toMatchObject({ playerId: ana, status: "draft" });
    const patched = await app.inject({ method: "PATCH", url: `/api/players/${ana}/creation`, headers: h, payload: { choices: { name: "Ana's hero" } } });
    expect(patched.json().draft.choices.name).toBe("Ana's hero");
    const bad = await app.inject({ method: "PATCH", url: `/api/players/${ana}/creation`, headers: h, payload: { choices: { baseAbilities: { str: 99 } } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/baseAbilities\.str/);
    expect((await app.inject({ method: "PATCH", url: `/api/players/${bo}/creation`, headers: h, payload: { choices: {} } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/players/${bo}/creation/join`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/creation/pending", headers: h })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/creation/${ana}/approve`, headers: h })).statusCode).toBe(401);
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

  it("a host logout revokes that host cookie on the server, not just in the browser", async () => {
    const { app } = await setup();
    const signIn = await app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "hunter2" } });
    const cookie = cookieOf(signIn);
    const other = cookieOf(await app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "hunter2" } }));
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: { ...REMOTE, cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { ...REMOTE, cookie } })).statusCode).toBe(200);
    // A copy of the cookie kept elsewhere (or not cleared by the browser) is dead, and so is every host cookie.
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: { ...REMOTE, cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: { ...REMOTE, cookie: other } })).statusCode).toBe(401);
    const again = await app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "hunter2" } });
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: { ...REMOTE, cookie: cookieOf(again) } })).statusCode).toBe(200);
  });

  it("sign out other host devices: the others' cookies die, the caller gets a fresh one", async () => {
    const { app, ana } = await setup();
    const host = () => app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "hunter2" } }).then(cookieOf);
    const mine = await host();
    const theirs = await host();
    const revoke = await app.inject({ method: "POST", url: "/api/auth/hosts/revoke", headers: { ...REMOTE, cookie: mine } });
    expect(revoke.statusCode).toBe(200);
    const fresh = cookieOf(revoke);
    const campaigns = (cookie: string) => app.inject({ method: "GET", url: "/api/campaigns", headers: { ...REMOTE, cookie } }).then((r) => r.statusCode);
    expect(await campaigns(fresh)).toBe(200);
    expect(await campaigns(mine)).toBe(401);
    expect(await campaigns(theirs)).toBe(401);
    // This machine (no cookie) can do it too: nothing to re-issue.
    const later = await host();
    const local = await app.inject({ method: "POST", url: "/api/auth/hosts/revoke" });
    expect(local.statusCode).toBe(200);
    expect(local.headers["set-cookie"]).toBeUndefined();
    expect(await campaigns(later)).toBe(401);
    // Players can't.
    const { cookie } = await joinAndClaim(app, ana);
    expect((await app.inject({ method: "POST", url: "/api/auth/hosts/revoke", headers: { ...REMOTE, cookie } })).statusCode).toBe(401);
  });

  it("the server's LAN addresses (player-urls) are for the room, not tunnelled players", async () => {
    const { app, ana } = await setup();
    const { cookie } = await joinAndClaim(app, ana);
    expect((await app.inject({ method: "GET", url: "/api/player-urls", headers: { ...REMOTE, cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/player-urls", remoteAddress: "192.168.1.7" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/player-urls" })).statusCode).toBe(200);
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

  it("typed input is trimmed and capped on the server; blank text is refused before the DM", async () => {
    const { app, game, ana } = await setup();
    const said = vi.spyOn(game, "sendText").mockImplementation(() => {});
    const { cookie } = await joinAndClaim(app, ana);
    const h = { ...REMOTE, cookie };
    expect((await app.inject({ method: "POST", url: "/api/dm/say", headers: h, payload: { text: "   ", playerId: ana } })).statusCode).toBe(400);
    expect(said).not.toHaveBeenCalled();
    const res = await app.inject({ method: "POST", url: "/api/dm/say", headers: h, payload: { text: `  ${"x".repeat(SAY_MAX * 10)}`, playerId: ana } });
    expect(res.statusCode).toBe(200);
    expect(said).toHaveBeenCalledWith("x".repeat(SAY_MAX), ana);
  });

  it("a remote player's typed input is throttled; the host's is not", async () => {
    const { app, game, ana } = await setup();
    const said = vi.spyOn(game, "sendText").mockImplementation(() => {});
    const { cookie } = await joinAndClaim(app, ana);
    const h = { ...REMOTE, cookie };
    const say = (headers: Record<string, string>, playerId?: string) => app.inject({ method: "POST", url: "/api/dm/say", headers, payload: { text: "I attack", playerId } });
    expect((await say(h, ana)).statusCode).toBe(200);
    const again = await say(h, ana);
    expect(again.statusCode).toBe(429);
    expect(again.json().error).toBeTruthy();
    expect((await say({}, ana)).statusCode).toBe(200);
    expect((await say({}, ana)).statusCode).toBe(200);
    expect(said).toHaveBeenCalledTimes(3);
  });

  it("a remote player can't type over someone else holding the push-to-talk floor", async () => {
    const { app, game, ana, bo } = await setup();
    const said = vi.spyOn(game, "sendText").mockImplementation(() => {});
    vi.spyOn(game, "floorView").mockReturnValue({ pushToTalk: true, holder: { playerId: bo, inRoom: false } });
    const { cookie } = await joinAndClaim(app, ana);
    const res = await app.inject({ method: "POST", url: "/api/dm/say", headers: { ...REMOTE, cookie }, payload: { text: "wait", playerId: ana } });
    expect(res.statusCode).toBe(409);
    expect(said).not.toHaveBeenCalled();
    // The host still can (it typed for a seat on purpose).
    expect((await app.inject({ method: "POST", url: "/api/dm/say", payload: { text: "wait", playerId: ana } })).statusCode).toBe(200);
  });

  it("the floor check: the room holding blocks a remote player, holding it yourself or push-to-talk off does not", async () => {
    const { app, game, ana } = await setup();
    vi.spyOn(game, "sendText").mockImplementation(() => {});
    const floor = vi.spyOn(game, "floorView");
    const { cookie } = await joinAndClaim(app, ana);
    const h = { ...REMOTE, cookie };
    const say = () => app.inject({ method: "POST", url: "/api/dm/say", headers: h, payload: { text: "hi", playerId: ana } });
    floor.mockReturnValue({ pushToTalk: true, holder: { room: true } });
    expect((await say()).statusCode).toBe(409);
    floor.mockReturnValue({ pushToTalk: true, holder: { playerId: ana, inRoom: false } });
    expect((await say()).statusCode).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10_000);
    floor.mockReturnValue({ pushToTalk: false, holder: { room: true } });
    expect((await say()).statusCode).toBe(200);
    vi.useRealTimers();
  });

  it("a typed line that never reached the DM doesn't use up the player's throttle slot", async () => {
    const { app, game, ana } = await setup();
    const said = vi.spyOn(game, "sendText").mockImplementationOnce(() => {
      throw new Error("The DM is reconnecting; try again in a moment.");
    });
    said.mockImplementation(() => {});
    const { cookie } = await joinAndClaim(app, ana);
    const say = () => app.inject({ method: "POST", url: "/api/dm/say", headers: { ...REMOTE, cookie }, payload: { text: "hi", playerId: ana } });
    expect((await say()).statusCode).toBe(400);
    expect((await say()).statusCode).toBe(200);
  });

  it("the host's typed input is not capped at the players' length limit", async () => {
    const { app, game, ana } = await setup();
    const said = vi.spyOn(game, "sendText").mockImplementation(() => {});
    const long = "y".repeat(SAY_MAX * 3);
    expect((await app.inject({ method: "POST", url: "/api/dm/say", payload: { text: ` ${long} `, playerId: ana } })).statusCode).toBe(200);
    expect(said).toHaveBeenCalledWith(long, ana);
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

  // The table mic is the whole room's: a tunnelled player muting it would cut every voice in the room.
  it("muting the table mic from a seat is a table route: a remote player can't, a LAN phone can", async () => {
    const { app, game, ana } = await setup();
    const { cookie } = await joinAndClaim(app, ana);
    const remote = await app.inject({ method: "POST", url: `/api/players/${ana}/mic`, headers: { ...REMOTE, cookie }, payload: { muted: true } });
    expect(remote.statusCode).toBe(401);
    expect(game.isMicMuted).toBe(false);
    const lan = await app.inject({ method: "POST", url: `/api/players/${ana}/mic`, payload: { muted: true }, remoteAddress: "192.168.1.7" });
    expect(lan.statusCode).toBe(200);
    expect(game.isMicMuted).toBe(true);
  });

  // A local proxy (ssh -R, nginx keeping Host) that adds no X-Forwarded-For: the peer is 127.0.0.1.
  it("a request for the ONLINE_URL host from loopback without forwarding headers is remote, not the host", async () => {
    const { app, ana } = await setup({ onlineUrl: "https://dnd.example.com" });
    const viaProxy = { host: "dnd.example.com" };
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: viaProxy })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: viaProxy })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: viaProxy })).json()).toMatchObject({ level: "none" });
    // This machine's own browser still is the host.
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: { host: "localhost:8787" } })).statusCode).toBe(200);
  });

  // ssh -R / socat pass the caller's own Host through: `Host: localhost` from the internet.
  it("with LOCAL_FORWARDER, a loopback request is remote even when it says Host: localhost", async () => {
    const { app, ana } = await setup({ onlineUrl: "https://dnd.example.com", localForwarder: true });
    for (const host of ["localhost", "localhost:8787", "127.0.0.1"]) {
      expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: { host } })).statusCode, host).toBe(401);
      expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: { host } })).statusCode, host).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { host } })).json(), host).toMatchObject({ level: "none" });
    }
    // The LAN keeps TRUST_LAN.
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, remoteAddress: "192.168.1.7" })).statusCode).toBe(200);
  });

  it("a loopback request for a home name that isn't a loopback name gets LAN trust at most", async () => {
    const { app, ana } = await setup({ publicUrl: "http://gamebox.local:8787" });
    const h = { host: "gamebox.local:8787" };
    expect((await app.inject({ method: "GET", url: "/api/campaigns", headers: h })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/api/players/${ana}/notes`, headers: h })).statusCode).toBe(200);
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

  it("freeing the push-to-talk floor is a host route", async () => {
    const { app, game, ana } = await setup();
    game.setPushToTalk(true);
    const { cookie } = await joinAndClaim(app, ana);
    const res401 = await app.inject({ method: "POST", url: "/api/floor/release", headers: { ...REMOTE, cookie } });
    expect(res401.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/floor/release", remoteAddress: "192.168.1.7" })).statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/api/floor/release" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pushToTalk: true, holder: null });
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
    expect(got.filter((e) => e.type === "floor").at(-1)).toEqual({ type: "floor", floor: { pushToTalk: true, holder: { playerId: ana, inRoom: false }, holdLeftMs: expect.any(Number) } });
  });

  it("the call: the TV joins as the room, a remote page as its seat; signals relay between them only; a LAN phone can't join", async () => {
    const { url, app, ana, bo } = await listening();
    const { cookie } = await joinAndClaim(app, ana);
    const collect = (ws: WebSocket) => {
      const got: ServerEvent[] = [];
      ws.on("message", (d) => got.push(JSON.parse(String(d))));
      return got;
    };
    const tv = (await tryOpen(`${url}/ws`, { "x-forwarded-for": "192.168.1.5" })).ws!;
    const remote = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie })).ws!;
    const phone = (await tryOpen(`${url}/ws`, { "x-forwarded-for": "192.168.1.7" })).ws!;
    cleanup.push(() => tv.close(), () => remote.close(), () => phone.close());
    const [fromTv, fromRemote, fromPhone] = [collect(tv), collect(remote), collect(phone)];
    const prefs = { camera: true, showCharacter: false, micOn: true };
    tv.send(JSON.stringify({ type: "hello", role: "table" }));
    remote.send(JSON.stringify({ type: "hello", role: "player" }));
    phone.send(JSON.stringify({ type: "hello", role: "player" }));
    tv.send(JSON.stringify({ type: "rtc_join", prefs }));
    // The remote page tries another seat: it joins as its own.
    remote.send(JSON.stringify({ type: "rtc_join", prefs, playerId: bo }));
    phone.send(JSON.stringify({ type: "rtc_join", prefs, playerId: bo }));
    await new Promise((r) => setTimeout(r, 150));
    const peersOf = (got: ServerEvent[]) => got.filter((e): e is Extract<ServerEvent, { type: "peers" }> => e.type === "peers").at(-1)!;
    const room = peersOf(fromTv).self!;
    const me = peersOf(fromRemote).self!;
    expect(peersOf(fromTv).peers.map((p) => p.playerId ?? "room")).toEqual(["room", ana]);
    expect(peersOf(fromPhone)).toMatchObject({ self: null, refused: expect.any(String) });
    tv.send(JSON.stringify({ type: "rtc", to: me, signal: { description: { type: "offer", sdp: "v=0" } } }));
    phone.send(JSON.stringify({ type: "rtc", to: me, signal: { candidate: null } }));
    await new Promise((r) => setTimeout(r, 150));
    expect(fromRemote.filter((e) => e.type === "rtc")).toEqual([{ type: "rtc", from: room, signal: { description: { type: "offer", sdp: "v=0" } } }]);
    // Closing the remote page leaves the call.
    remote.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(peersOf(fromTv).peers.map((p) => p.peerId)).toEqual([room]);
  });

  // GameService.broadcastVoiceOwner -> rtc.setRoomOwner: the call's room is the table carrying the voice DM,
  // or remote players would get no DM voice and the DM wouldn't hear them.
  it("the call's room follows the voice owner: the table that owns the voice is the room", async () => {
    const { url } = await listening();
    const collect = (ws: WebSocket) => {
      const got: ServerEvent[] = [];
      ws.on("message", (d) => got.push(JSON.parse(String(d))));
      return got;
    };
    const tv1 = (await tryOpen(`${url}/ws`, {})).ws!;
    const tv2 = (await tryOpen(`${url}/ws`, {})).ws!;
    cleanup.push(() => tv1.close(), () => tv2.close());
    const [from1, from2] = [collect(tv1), collect(tv2)];
    const prefs = { camera: false, showCharacter: false, micOn: true };
    const peersOf = (got: ServerEvent[]) => got.filter((e): e is Extract<ServerEvent, { type: "peers" }> => e.type === "peers").at(-1)!;
    tv1.send(JSON.stringify({ type: "hello", role: "table" }));
    tv1.send(JSON.stringify({ type: "rtc_join", prefs }));
    await new Promise((r) => setTimeout(r, 100));
    expect(peersOf(from1).self).toMatch(/^r/);
    tv2.send(JSON.stringify({ type: "hello", role: "table" }));
    tv2.send(JSON.stringify({ type: "rtc_join", prefs }));
    await new Promise((r) => setTimeout(r, 100));
    // Unclaimed, the newest table owns the voice (pickVoiceOwner), so it is the room, not the first to join.
    expect(peersOf(from2).self).toMatch(/^r/);
    expect(peersOf(from2).peers.map((p) => p.peerId)).toEqual([peersOf(from2).self]);
    expect(peersOf(from1)).toMatchObject({ self: null, refused: expect.any(String) });
    // The older table's call comes up: it claims the voice and becomes the room.
    tv1.send(JSON.stringify({ type: "voice_link", state: "connected" }));
    await new Promise((r) => setTimeout(r, 150));
    expect(peersOf(from1).self).toMatch(/^r/);
    expect(peersOf(from2)).toMatchObject({ self: null, refused: expect.any(String) });
  });

  it("with TRUST_LAN off, a home-network player cookie holds the floor in the room; a tunnelled one doesn't", async () => {
    const { url, app, game, ana, bo } = await listening({ trustLan: false, hostLocalBypass: false });
    game.setPushToTalk(true);
    const here = await joinAndClaim(app, ana, "203.0.113.1");
    const away = await joinAndClaim(app, bo, "203.0.113.2");
    // No cf-connecting-ip: the socket comes straight from this machine's network (the phone at the table).
    const lan = (await tryOpen(`${url}/ws`, { cookie: here.cookie })).ws!;
    const remote = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie: away.cookie })).ws!;
    cleanup.push(() => lan.close(), () => remote.close());
    lan.send(JSON.stringify({ type: "hello", role: "player" }));
    remote.send(JSON.stringify({ type: "hello", role: "player" }));
    lan.send(JSON.stringify({ type: "ptt", down: true }));
    await new Promise((r) => setTimeout(r, 100));
    expect(game.floorView().holder).toEqual({ playerId: ana, inRoom: true });
    lan.send(JSON.stringify({ type: "ptt", down: false }));
    remote.send(JSON.stringify({ type: "ptt", down: true }));
    await new Promise((r) => setTimeout(r, 100));
    expect(game.floorView().holder).toEqual({ playerId: bo, inRoom: false });
  });

  // TRUST_LAN lifts a home-network player cookie to table level; it still holds its seat.
  it("a seat claimed from the home network is online and held while connected and for the grace time", async () => {
    let skew = 0;
    const store = new AuthStore({ envCode: CODE, now: () => Date.now() - 600_000 });
    const { url, app, ana } = await listening({ store, seatGraceMs: 60_000, now: () => Date.now() + skew });
    const lan = { "x-forwarded-for": "192.168.1.7" };
    const joined = await app.inject({ method: "POST", url: "/api/auth/join", remoteAddress: "192.168.1.7", payload: { code: CODE } });
    const claimed = await app.inject({ method: "POST", url: "/api/auth/claim", remoteAddress: "192.168.1.7", headers: { cookie: cookieOf(joined) }, payload: { playerId: ana } });
    expect(claimed.statusCode).toBe(200);
    const { ws } = await tryOpen(`${url}/ws`, { ...lan, cookie: cookieOf(claimed) });
    expect(ws).toBeDefined();
    await new Promise((r) => setTimeout(r, 50));
    const seat = async () => ((await app.inject({ method: "GET", url: "/api/auth/sessions" })).json().seats as { playerId: string; connected: number }[]).find((x) => x.playerId === ana);
    expect(await seat()).toMatchObject({ connected: 1 });
    // Well past the grace time, but the socket is open: the seat is in use.
    skew = 61_000;
    expect((await joinAndClaim(app, ana, "203.0.113.2")).claimed.statusCode).toBe(409);
    const closed = new Promise((r) => ws!.once("close", r));
    ws!.close();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    skew = 30_000;
    expect((await joinAndClaim(app, ana, "203.0.113.3")).claimed.statusCode).toBe(409);
    skew = 61_000;
    expect((await joinAndClaim(app, ana, "203.0.113.4")).claimed.statusCode).toBe(200);
  });

  it("kicking a seat closes its home-network socket too", async () => {
    const { url, app, ana } = await listening();
    const joined = await app.inject({ method: "POST", url: "/api/auth/join", remoteAddress: "192.168.1.7", payload: { code: CODE } });
    const claimed = await app.inject({ method: "POST", url: "/api/auth/claim", remoteAddress: "192.168.1.7", headers: { cookie: cookieOf(joined) }, payload: { playerId: ana } });
    const { ws } = await tryOpen(`${url}/ws`, { "x-forwarded-for": "192.168.1.7", cookie: cookieOf(claimed) });
    expect(ws).toBeDefined();
    cleanup.push(() => ws!.close());
    const closed = new Promise<number>((r) => ws!.once("close", (code) => r(code)));
    await app.inject({ method: "POST", url: "/api/auth/kick", payload: { playerId: ana } });
    expect(await closed).toBe(4401);
  });

  it("signing other host devices out closes every host socket, a copy of the caller's cookie included", async () => {
    const { url, app } = await listening();
    const host = () => app.inject({ method: "POST", url: "/api/auth/host", headers: REMOTE, payload: { password: "hunter2" } }).then(cookieOf);
    const mine = await host();
    const theirs = await host();
    const a = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie: mine })).ws!;
    // A copy of the caller's own cookie (same sid) open somewhere else.
    const copy = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie: mine })).ws!;
    const b = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie: theirs })).ws!;
    cleanup.push(() => a.close(), () => copy.close(), () => b.close());
    const closedCode = (ws: WebSocket) => new Promise<number>((r) => ws.once("close", (code) => r(code)));
    const closed = [closedCode(a), closedCode(copy), closedCode(b)];
    const revoke = await app.inject({ method: "POST", url: "/api/auth/hosts/revoke", headers: { ...REMOTE, cookie: mine } });
    expect(revoke.statusCode).toBe(200);
    // Closed with "reconnect" rather than "signed out": the caller's page must not ask /api/auth/me
    // before the browser holds its new cookie. A copy's reconnect is then refused and it signs in.
    expect(await Promise.all(closed)).toEqual([WS_RECONNECT, WS_RECONNECT, WS_RECONNECT]);
    // The caller's tabs reconnect with the re-issued cookie, which has a fresh sign-in id.
    const fresh = cookieOf(revoke);
    const sid = (cookie: string) => JSON.parse(Buffer.from(cookie.split("=")[1]!.split(".")[0]!, "base64url").toString()).sid;
    expect(sid(fresh)).not.toBe(sid(mine));
    const again = (await tryOpen(`${url}/ws`, { ...REMOTE, cookie: fresh })).ws;
    expect(again).toBeDefined();
    cleanup.push(() => again!.close());
    expect((await tryOpen(`${url}/ws`, { ...REMOTE, cookie: mine })).ws).toBeUndefined();
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

describe("WebSocket heartbeat (app.ts createSockets)", () => {
  afterEach(() => vi.useRealTimers());

  /** A hub socket that never answers a ping (a phone that dropped off Wi-Fi). */
  function silent() {
    const ws = Object.assign(new EventEmitter(), {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
    });
    return ws as unknown as HubSocket & { ping: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> };
  }

  it("pings /ws sockets every 10 s, terminates one that missed a pong, and stops when the app closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { app, game } = await setup();
    const left = vi.fn();
    game.hub.onClose(left);
    const ws = silent();
    game.hub.add(ws);
    vi.advanceTimersByTime(10_000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledWith(ws, undefined);
    await app.close();
    const later = silent();
    game.hub.add(later);
    vi.advanceTimersByTime(60_000);
    expect(later.ping).not.toHaveBeenCalled();
  });
});
