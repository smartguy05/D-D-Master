import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore, newTableCode, normalizeCode } from "./store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmpFile = () => {
  const d = mkdtempSync(join(tmpdir(), "dm-auth-"));
  dirs.push(d);
  return join(d, "auth.json");
};

describe("table codes", () => {
  // Two words and four digits: 48 x 48 x 10,000 = 23 million codes, so guessing through the tunnel
  // (rate-limited, auth/ratelimit.ts) is hopeless.
  it("newTableCode looks like WOLF-RUNE-7342", () => {
    for (let i = 0; i < 20; i++) expect(newTableCode()).toMatch(/^[A-Z]{3,6}-[A-Z]{3,6}-\d{4}$/);
  });

  it("normalizeCode ignores case, spaces and dashes", () => {
    expect(normalizeCode(" wolf 7342 ")).toBe(normalizeCode("WOLF-7342"));
    expect(normalizeCode("wolf—7342")).toBe("WOLF7342");
  });
});

describe("AuthStore", () => {
  it("makes a secret and a code once and keeps them in auth.json (owner-only)", () => {
    const file = tmpFile();
    const a = new AuthStore({ file });
    expect(a.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(a.code).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
    expect(a.gen).toBe(1);
    expect(a.fixedCode).toBe(false);
    const b = new AuthStore({ file });
    expect(b.secret).toBe(a.secret);
    expect(b.code).toBe(a.code);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);
  });

  it("works without a file (tests, throwaway servers)", () => {
    const a = new AuthStore({});
    expect(a.secret).toHaveLength(64);
    a.rotate();
    expect(a.gen).toBe(2);
  });

  it("matches the code loosely", () => {
    const a = new AuthStore({ envCode: "Wolf-7342" });
    expect(a.codeMatches("wolf 7342")).toBe(true);
    expect(a.codeMatches("WOLF-7343")).toBe(false);
    expect(a.codeMatches("")).toBe(false);
  });

  it("rotate makes a new code, bumps the generation, frees every seat and persists", () => {
    const file = tmpFile();
    const a = new AuthStore({ file });
    const old = a.code;
    a.claim("pl_1", "sidA");
    const code = a.rotate();
    expect(code).not.toBe(old);
    expect(a.gen).toBe(2);
    expect(a.seatOwner("pl_1")).toBeUndefined();
    const b = new AuthStore({ file });
    expect(b.code).toBe(code);
    expect(b.gen).toBe(2);
  });

  it("TABLE_CODE from .env is fixed: rotate refuses; changing it logs players out", () => {
    const file = tmpFile();
    const a = new AuthStore({ file, envCode: "DRAGON-1111" });
    expect(a.code).toBe("DRAGON-1111");
    expect(a.fixedCode).toBe(true);
    expect(() => a.rotate()).toThrow(/TABLE_CODE/);
    expect(new AuthStore({ file, envCode: "DRAGON-1111" }).gen).toBe(1);
    expect(new AuthStore({ file, envCode: "DRAGON-2222" }).gen).toBe(2);
  });

  it("a seat belongs to one session until it is released", () => {
    const a = new AuthStore({});
    expect(a.claim("pl_1", "sidA")).toEqual({ ok: true });
    expect(a.claim("pl_1", "sidA")).toEqual({ ok: true });
    expect(a.claim("pl_1", "sidB")).toEqual({ ok: false });
    expect(a.seatOwner("pl_1")).toBe("sidA");
    expect(a.release("pl_1")).toBe(true);
    expect(a.release("pl_1")).toBe(false);
    expect(a.claim("pl_1", "sidB")).toEqual({ ok: true });
  });

  it("a forced claim takes over a seat whose holder is gone (routes/auth.ts decides when)", () => {
    const a = new AuthStore({ now: () => 5 });
    a.claim("pl_1", "sidA");
    expect(a.claim("pl_1", "sidB", { force: true })).toEqual({ ok: true });
    expect(a.seatOwner("pl_1")).toBe("sidB");
    expect(a.claims()).toEqual([{ playerId: "pl_1", sid: "sidB", at: 5 }]);
  });

  it("a session moving to another seat frees its old one", () => {
    const a = new AuthStore({});
    a.claim("pl_1", "sidA");
    a.claim("pl_2", "sidA");
    expect(a.seatOwner("pl_1")).toBeUndefined();
    expect(a.seatOwner("pl_2")).toBe("sidA");
    expect(a.claims().map((c) => c.playerId)).toEqual(["pl_2"]);
  });

  it("a corrupt auth.json is replaced instead of crashing the server", () => {
    const file = tmpFile();
    writeFileSync(file, "{not json");
    const a = new AuthStore({ file, warn: () => undefined });
    expect(a.secret).toHaveLength(64);
    expect(JSON.parse(readFileSync(file, "utf8")).secret).toBe(a.secret);
  });
});
