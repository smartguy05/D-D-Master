import { describe, expect, it } from "vitest";
import { accessFor, allows, clampRole, routeNeed, type Access, type AuthPolicy } from "./access.js";
import type { TokenPayload } from "./token.js";

const on: AuthPolicy = { trustLan: true, hostLocalBypass: true };
const local = { kind: "local", ip: "127.0.0.1" } as const;
const lan = { kind: "lan", ip: "192.168.1.7" } as const;
const remote = { kind: "remote", ip: "203.0.113.9" } as const;
const hostTok: TokenPayload = { k: "host", sid: "h", gen: 1, iat: 0, pw: "x" };
const seatTok: TokenPayload = { k: "player", sid: "p", pid: "pl_1", gen: 1, iat: 0 };
const joinedTok: TokenPayload = { k: "player", sid: "j", gen: 1, iat: 0 };

describe("accessFor", () => {
  it("this machine is the host (HOST_LOCAL_BYPASS)", () => {
    expect(accessFor(local, undefined, on)).toEqual({ level: "host", anySeat: true });
  });

  it("without the bypass, this machine is like the LAN", () => {
    expect(accessFor(local, undefined, { ...on, hostLocalBypass: false })).toEqual({ level: "table", anySeat: true });
    expect(accessFor(local, undefined, { trustLan: false, hostLocalBypass: false })).toEqual({ level: "none", anySeat: false });
  });

  it("the LAN is table + any seat with TRUST_LAN, nothing without it", () => {
    expect(accessFor(lan, undefined, on)).toEqual({ level: "table", anySeat: true });
    expect(accessFor(lan, undefined, { ...on, trustLan: false })).toEqual({ level: "none", anySeat: false });
  });

  it("remote callers need a cookie", () => {
    expect(accessFor(remote, undefined, on)).toEqual({ level: "none", anySeat: false });
    expect(accessFor(remote, hostTok, on)).toEqual({ level: "host", anySeat: true, sid: "h" });
    expect(accessFor(remote, seatTok, on)).toEqual({ level: "player", anySeat: false, playerId: "pl_1", sid: "p" });
    expect(accessFor(remote, joinedTok, on)).toEqual({ level: "player", anySeat: false, sid: "j" });
  });

  it("the best of origin and cookie wins", () => {
    expect(accessFor(lan, seatTok, on)).toEqual({ level: "table", anySeat: true, playerId: "pl_1", sid: "p" });
    expect(accessFor(lan, hostTok, on).level).toBe("host");
  });
});

describe("routeNeed", () => {
  it("everything under /api is host-only unless listed", () => {
    expect(routeNeed("GET", "/api/campaigns", {})).toEqual({ level: "host" });
    expect(routeNeed("DELETE", "/api/campaigns/:id", { id: "x" })).toEqual({ level: "host" });
    expect(routeNeed("POST", "/api/tools/:name", { name: "roll_dice" })).toEqual({ level: "host" });
    expect(routeNeed("GET", "/api/status", {})).toEqual({ level: "host" });
    expect(routeNeed("POST", "/api/dm/voice/start", {})).toEqual({ level: "host" });
    expect(routeNeed("GET", "/api/some-new-route", {})).toEqual({ level: "host" });
  });

  it("a player's own seat routes need that seat", () => {
    for (const [m, sub] of [["POST", "roll"], ["POST", "physical-roll"], ["GET", "notes"], ["PUT", "notes"], ["GET", "spells"], ["POST", "mic"], ["POST", "dice-mode"]]) {
      expect(routeNeed(m, `/api/players/:id/${sub}`, { id: "pl_1" })).toEqual({ level: "player", seat: "pl_1" });
    }
  });

  it("host-side player routes stay host-only", () => {
    expect(routeNeed("PATCH", "/api/players/:id", { id: "pl_1" })).toEqual({ level: "host" });
    expect(routeNeed("DELETE", "/api/players/:id", { id: "pl_1" })).toEqual({ level: "host" });
    expect(routeNeed("POST", "/api/players/:id/enroll/start", { id: "pl_1" })).toEqual({ level: "host" });
    expect(routeNeed("POST", "/api/players/:id/ai/nudge", { id: "pl_1" })).toEqual({ level: "host" });
    expect(routeNeed("POST", "/api/players", {})).toEqual({ level: "host" });
  });

  it("player and table allowlists", () => {
    expect(routeNeed("GET", "/api/player-urls", {})).toEqual({ level: "player" });
    expect(routeNeed("GET", "/api/rtc/config", {})).toEqual({ level: "player" });
    expect(routeNeed("POST", "/api/dm/say", {})).toEqual({ level: "player" });
    expect(routeNeed("POST", "/api/mic", {})).toEqual({ level: "table" });
    expect(routeNeed("POST", "/api/npc/clip-ended", {})).toEqual({ level: "table" });
    expect(routeNeed("POST", "/api/dm/voice", {})).toEqual({ level: "table" });
  });

  it("sign-in routes", () => {
    for (const p of ["/api/auth/host", "/api/auth/join", "/api/auth/logout"]) expect(routeNeed("POST", p, {})).toEqual({ level: "public" });
    expect(routeNeed("GET", "/api/auth/me", {})).toEqual({ level: "public" });
    expect(routeNeed("GET", "/api/auth/claim", {})).toEqual({ level: "player" });
    expect(routeNeed("POST", "/api/auth/claim", {})).toEqual({ level: "player" });
    expect(routeNeed("POST", "/api/auth/code/rotate", {})).toEqual({ level: "host" });
    expect(routeNeed("POST", "/api/auth/kick", {})).toEqual({ level: "host" });
    expect(routeNeed("GET", "/api/auth/sessions", {})).toEqual({ level: "host" });
  });

  it("media, the web app and unmatched URLs are public", () => {
    expect(routeNeed("GET", "/media/:campaignId/:file", {})).toEqual({ level: "public" });
    expect(routeNeed("GET", "/*", {})).toEqual({ level: "public" });
    expect(routeNeed("GET", undefined, {})).toEqual({ level: "public" });
  });
});

describe("allows", () => {
  const a = (level: Access["level"], extra: Partial<Access> = {}): Access => ({ level, anySeat: level === "host" || level === "table", ...extra });

  it("levels are ordered host > table > player > none", () => {
    expect(allows(a("host"), { level: "host" })).toBe(true);
    expect(allows(a("table"), { level: "host" })).toBe(false);
    expect(allows(a("table"), { level: "table" })).toBe(true);
    expect(allows(a("player", { playerId: "pl_1" }), { level: "table" })).toBe(false);
    expect(allows(a("player"), { level: "player" })).toBe(true);
    expect(allows(a("none"), { level: "player" })).toBe(false);
    expect(allows(a("none"), { level: "public" })).toBe(true);
  });

  it("seat routes: only the bound seat, or any seat for host and LAN", () => {
    const seat = { level: "player", seat: "pl_1" } as const;
    expect(allows(a("player", { playerId: "pl_1" }), seat)).toBe(true);
    expect(allows(a("player", { playerId: "pl_2" }), seat)).toBe(false);
    expect(allows(a("player"), seat)).toBe(false);
    expect(allows(a("table"), seat)).toBe(true);
    expect(allows(a("host"), seat)).toBe(true);
  });
});

describe("clampRole (the hello on /ws)", () => {
  it("a player can't claim host or table; a LAN table can't claim host", () => {
    expect(clampRole({ level: "player", anySeat: false, playerId: "pl_1" }, "host")).toBe("player");
    expect(clampRole({ level: "player", anySeat: false }, "table")).toBe("player");
    expect(clampRole({ level: "table", anySeat: true }, "host")).toBe("table");
    expect(clampRole({ level: "table", anySeat: true }, "player")).toBe("player");
    expect(clampRole({ level: "host", anySeat: true }, "host")).toBe("host");
    expect(clampRole({ level: "host", anySeat: true }, "table")).toBe("table");
  });
});
