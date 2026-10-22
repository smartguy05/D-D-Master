import { describe, expect, it } from "vitest";
import { AUTH_COOKIE, authCookie, clearAuthCookie, passwordFingerprint, readCookie, safeEqual, signToken, verifyToken, type TokenPayload } from "./token.js";

const SECRET = "s".repeat(64);
const DAY = 86_400_000;
const now = 1_800_000_000_000;
const player: TokenPayload = { k: "player", sid: "sid1", pid: "pl_1", gen: 3, iat: now };
const ctx = (over: Partial<Parameters<typeof verifyToken>[1]> = {}) => ({
  secret: SECRET,
  gen: 3,
  now,
  hostFingerprint: passwordFingerprint("hunter2", SECRET),
  seatOwner: (pid: string) => (pid === "pl_1" ? "sid1" : undefined),
  ...over,
});

describe("signToken / verifyToken", () => {
  it("round-trips a player token", () => {
    expect(verifyToken(signToken(player, SECRET), ctx())).toEqual(player);
  });

  it("refuses a tampered payload or signature, another secret and junk", () => {
    const t = signToken(player, SECRET);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...player, k: "host" })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, ctx())).toBeUndefined();
    expect(verifyToken(`${body}.${sig.slice(0, -2)}xx`, ctx())).toBeUndefined();
    expect(verifyToken(signToken(player, "other".repeat(10)), ctx())).toBeUndefined();
    for (const junk of ["", ".", "abc", "a.b.c", undefined]) expect(verifyToken(junk, ctx())).toBeUndefined();
  });

  it("player tokens die when the code generation changes (rotating the code logs everyone out)", () => {
    expect(verifyToken(signToken(player, SECRET), ctx({ gen: 4 }))).toBeUndefined();
  });

  it("a bound player token dies when its seat is released or claimed by another session (kick)", () => {
    const t = signToken(player, SECRET);
    expect(verifyToken(t, ctx({ seatOwner: () => undefined }))).toBeUndefined();
    expect(verifyToken(t, ctx({ seatOwner: () => "sid2" }))).toBeUndefined();
  });

  it("an unbound player token (joined, no seat yet) only needs the generation", () => {
    const joined: TokenPayload = { k: "player", sid: "sid9", gen: 3, iat: now };
    expect(verifyToken(signToken(joined, SECRET), ctx())).toEqual(joined);
  });

  it("tokens expire after 30 days and refuse a future issue time", () => {
    const t = signToken(player, SECRET);
    expect(verifyToken(t, ctx({ now: now + 29 * DAY }))).toBeDefined();
    expect(verifyToken(t, ctx({ now: now + 31 * DAY }))).toBeUndefined();
    expect(verifyToken(signToken({ ...player, iat: now + DAY }, SECRET), ctx())).toBeUndefined();
  });

  it("host tokens survive a code rotation but die when HOST_PASSWORD changes or is cleared", () => {
    const host: TokenPayload = { k: "host", sid: "h1", gen: 3, iat: now, pw: passwordFingerprint("hunter2", SECRET) };
    const t = signToken(host, SECRET);
    expect(verifyToken(t, ctx({ gen: 9 }))).toEqual(host);
    expect(verifyToken(t, ctx({ hostFingerprint: passwordFingerprint("new-pass", SECRET) }))).toBeUndefined();
    expect(verifyToken(t, ctx({ hostFingerprint: undefined }))).toBeUndefined();
  });

  it("refuses payloads of the wrong shape even when signed", () => {
    expect(verifyToken(signToken({ k: "admin" } as unknown as TokenPayload, SECRET), ctx())).toBeUndefined();
    expect(verifyToken(signToken({ ...player, sid: 5 } as unknown as TokenPayload, SECRET), ctx())).toBeUndefined();
  });
});

describe("passwordFingerprint and safeEqual", () => {
  it("fingerprints depend on the secret and the password", () => {
    expect(passwordFingerprint("a", SECRET)).toBe(passwordFingerprint("a", SECRET));
    expect(passwordFingerprint("a", SECRET)).not.toBe(passwordFingerprint("b", SECRET));
    expect(passwordFingerprint("a", SECRET)).not.toBe(passwordFingerprint("a", "x".repeat(64)));
  });

  it("safeEqual compares strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("cookies", () => {
  it("readCookie finds the auth cookie among others", () => {
    expect(readCookie(`a=1; ${AUTH_COOKIE}=tok.sig; b=2`, AUTH_COOKIE)).toBe("tok.sig");
    expect(readCookie("a=1", AUTH_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, AUTH_COOKIE)).toBeUndefined();
  });

  it("authCookie is HttpOnly, SameSite=Lax, 30 days, Secure only over https", () => {
    const c = authCookie("tok.sig", false);
    expect(c).toBe(`${AUTH_COOKIE}=tok.sig; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
    expect(authCookie("tok.sig", true)).toMatch(/; Secure$/);
    expect(clearAuthCookie(false)).toMatch(/Max-Age=0/);
  });
});
