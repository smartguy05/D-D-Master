import { afterEach, describe, expect, it, vi } from "vitest";
import { afterSocketClose, needsCheck, redirectToSignIn, roleAllowed, safeNext, signInPath } from "./auth";

afterEach(() => vi.unstubAllGlobals());

describe("signInPath", () => {
  it("host pages go to /login, player pages to /join, with where to come back", () => {
    expect(signInPath("/host", "")).toBe("/login?next=%2Fhost");
    expect(signInPath("/table", "?x=1")).toBe("/login?next=%2Ftable%3Fx%3D1");
    expect(signInPath("/", "")).toBe("/login?next=%2F");
    expect(signInPath("/player/pl_1", "")).toBe("/join?next=%2Fplayer%2Fpl_1");
    expect(signInPath("/player", "")).toBe("/join?next=%2Fplayer");
    expect(signInPath("/play/pl_1", "")).toBe("/join?next=%2Fplay%2Fpl_1");
  });

  it("never redirects from a sign-in page to itself", () => {
    expect(signInPath("/login", "?next=%2Fhost")).toBeUndefined();
    expect(signInPath("/join", "?code=WOLF-1")).toBeUndefined();
  });
});

describe("safeNext (no open redirects)", () => {
  it("keeps same-site paths and refuses everything else", () => {
    expect(safeNext("/host", "/x")).toBe("/host");
    expect(safeNext("/player/pl_1?a=1", "/x")).toBe("/player/pl_1?a=1");
    expect(safeNext(null, "/x")).toBe("/x");
    expect(safeNext("https://evil.example", "/x")).toBe("/x");
    expect(safeNext("//evil.example", "/x")).toBe("/x");
    expect(safeNext("/\\evil.example", "/x")).toBe("/x");
    expect(safeNext("/login", "/x")).toBe("/x");
  });

  // Browsers drop tab, CR and LF while parsing a URL: "/\t/evil.com" becomes "//evil.com".
  it("refuses paths that a browser would turn into another site", () => {
    expect(safeNext("/\t/evil.com", "/x")).toBe("/x");
    expect(safeNext("/\n/evil.com", "/x")).toBe("/x");
    expect(safeNext("/\r/evil.com", "/x")).toBe("/x");
    expect(safeNext("\\\\evil.com", "/x")).toBe("/x");
    expect(safeNext("/\t/login", "/x")).toBe("/x");
    expect(safeNext("/table#top", "/x")).toBe("/table#top");
  });
});

describe("roleAllowed", () => {
  it("host pages need host, the TV needs table, phones any sign-in", () => {
    expect(roleAllowed("host", "host")).toBe(true);
    expect(roleAllowed("table", "host")).toBe(false);
    expect(roleAllowed("table", "table")).toBe(true);
    expect(roleAllowed("player", "table")).toBe(false);
    expect(roleAllowed("player", "player")).toBe(true);
    expect(roleAllowed("none", "player")).toBe(false);
  });
});

describe("redirectToSignIn", () => {
  it("sends the browser to the right sign-in page once", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/host", search: "", assign });
    expect(redirectToSignIn()).toBe(true);
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fhost");
  });

  it("does nothing on a sign-in page", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/login", search: "", assign });
    expect(redirectToSignIn()).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("afterSocketClose (useServer)", () => {
  const me = (level: "none" | "player" | "table" | "host") => ({ level, origin: "remote" as const, hostLogin: true });

  it("a socket that opened and dropped just reconnects (server restart, Wi-Fi blip)", () => {
    expect(needsCheck({ opened: true, code: 1006 })).toBe(false);
  });

  it("a refused upgrade or a sign-out close (4401) asks the server who we are", () => {
    expect(needsCheck({ opened: false, code: 1006 })).toBe(true);
    expect(needsCheck({ opened: true, code: 4401 })).toBe(true);
  });

  it("signs in when the access doesn't cover the page's role; retries when it does or the server is down", () => {
    expect(afterSocketClose(me("none"), "player")).toBe("sign-in");
    expect(afterSocketClose(me("player"), "host")).toBe("sign-in");
    expect(afterSocketClose(me("table"), "table")).toBe("retry");
    expect(afterSocketClose(undefined, "host")).toBe("retry");
  });
});
