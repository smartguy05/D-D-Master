import { describe, expect, it } from "vitest";
import { classifyOrigin, originAllowed } from "./origin.js";

describe("classifyOrigin", () => {
  it("loopback addressed as localhost with no proxy headers is local", () => {
    const host = { host: "localhost:8787" };
    expect(classifyOrigin("127.0.0.1", host)).toEqual({ kind: "local", ip: "127.0.0.1" });
    expect(classifyOrigin("::1", host)).toEqual({ kind: "local", ip: "::1" });
    expect(classifyOrigin("::ffff:127.0.0.1", host)).toEqual({ kind: "local", ip: "127.0.0.1" });
  });

  it("private, link-local and ULA addresses are lan", () => {
    for (const ip of ["10.0.0.5", "172.16.3.4", "172.31.255.1", "192.168.1.20", "169.254.10.1", "fe80::1", "fd12:3456::1", "::ffff:192.168.1.7"]) {
      expect(classifyOrigin(ip, {}).kind, ip).toBe("lan");
    }
    expect(classifyOrigin("::ffff:192.168.1.7", {}).ip).toBe("192.168.1.7");
  });

  it("public addresses are remote", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "100.64.0.1", "2001:db8::1", "11.0.0.1"]) {
      expect(classifyOrigin(ip, {}).kind, ip).toBe("remote");
    }
  });

  it("an unknown peer address is remote", () => {
    expect(classifyOrigin(undefined, {}).kind).toBe("remote");
    expect(classifyOrigin("", {}).kind).toBe("remote");
  });

  // Behind cloudflared every request comes from 127.0.0.1: the header is the only way to tell.
  it("a cf-connecting-ip header is always remote, whatever the peer and the header say", () => {
    expect(classifyOrigin("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" })).toEqual({ kind: "remote", ip: "203.0.113.9" });
    expect(classifyOrigin("127.0.0.1", { "cf-connecting-ip": "127.0.0.1" }).kind).toBe("remote");
    expect(classifyOrigin("127.0.0.1", { "cf-connecting-ip": "192.168.1.5" }).kind).toBe("remote");
    expect(classifyOrigin("127.0.0.1", { "cf-connecting-ip": ["1.2.3.4", "5.6.7.8"] }).ip).toBe("1.2.3.4");
  });

  it("x-forwarded-for from a loopback proxy uses the hop the proxy added (the last one)", () => {
    expect(classifyOrigin("127.0.0.1", { "x-forwarded-for": "203.0.113.9" })).toEqual({ kind: "remote", ip: "203.0.113.9" });
    // A client can write its own X-Forwarded-For; the proxy appends the real address after it.
    expect(classifyOrigin("127.0.0.1", { "x-forwarded-for": "127.0.0.1, 203.0.113.9" }).kind).toBe("remote");
    // The Vite dev proxy (xfwd) forwarding a LAN phone or the laptop itself.
    expect(classifyOrigin("127.0.0.1", { "x-forwarded-for": "::ffff:192.168.1.7" }).kind).toBe("lan");
    expect(classifyOrigin("::1", { host: "localhost:5173", "x-forwarded-for": "::1" }).kind).toBe("local");
  });

  it("x-forwarded-for never makes a request more trusted than its peer", () => {
    expect(classifyOrigin("192.168.1.7", { "x-forwarded-for": "127.0.0.1" }).kind).toBe("lan");
    expect(classifyOrigin("8.8.8.8", { "x-forwarded-for": "127.0.0.1" }).kind).toBe("remote");
    expect(classifyOrigin("8.8.8.8", { "x-forwarded-for": "192.168.1.2" }).kind).toBe("remote");
  });

  // Rate limits key on `ip`: a caller reaching the port directly must not pick its own address.
  it("only a proxy on this machine (cloudflared, Vite) may name the client's address", () => {
    expect(classifyOrigin("8.8.8.8", { "cf-connecting-ip": "1.1.1.1" })).toEqual({ kind: "remote", ip: "8.8.8.8" });
    expect(classifyOrigin("8.8.8.8", { "x-forwarded-for": "1.1.1.1" })).toEqual({ kind: "remote", ip: "8.8.8.8" });
    // A LAN device writing its own forwarding headers keeps its own address (it could rotate them per guess).
    expect(classifyOrigin("192.168.1.2", { "cf-connecting-ip": "1.1.1.1" })).toEqual({ kind: "remote", ip: "192.168.1.2" });
    expect(classifyOrigin("192.168.1.2", { "x-forwarded-for": "10.0.0.9" })).toEqual({ kind: "lan", ip: "192.168.1.2" });
    expect(classifyOrigin("127.0.0.1", { "cf-connecting-ip": "1.1.1.1" }).ip).toBe("1.1.1.1");
  });

  it("junk in the forwarding header is remote", () => {
    expect(classifyOrigin("127.0.0.1", { "x-forwarded-for": "not-an-ip" }).kind).toBe("remote");
    expect(classifyOrigin("127.0.0.1", { "x-forwarded-for": "" }).kind).toBe("remote");
  });

  // DNS rebinding: evil.example resolves to 127.0.0.1, so a web page there talks to us "from localhost".
  it("a local or lan request addressed to a public hostname is remote (DNS rebinding)", () => {
    expect(classifyOrigin("127.0.0.1", { host: "evil.example:8787" }).kind).toBe("remote");
    expect(classifyOrigin("192.168.1.7", { host: "evil.example" }).kind).toBe("remote");
    expect(classifyOrigin("127.0.0.1", { host: "localhost:8787" }).kind).toBe("local");
    expect(classifyOrigin("127.0.0.1", { host: "127.0.0.1:8787" }).kind).toBe("local");
    expect(classifyOrigin("127.0.0.1", { host: "[::1]:8787" }).kind).toBe("local");
    expect(classifyOrigin("192.168.1.7", { host: "192.168.1.20:8787" }).kind).toBe("lan");
    expect(classifyOrigin("192.168.1.7", { host: "gamebox:8787" }).kind).toBe("lan");
    expect(classifyOrigin("192.168.1.7", { host: "gamebox.local" }).kind).toBe("lan");
    expect(classifyOrigin("192.168.1.7", { host: "gamebox.lan" }).kind).toBe("lan");
    expect(classifyOrigin("192.168.1.7", { host: "dnd.example.com" }, { trustedHosts: ["dnd.example.com"] }).kind).toBe("lan");
  });

  // Routers hand out their own DNS suffixes (fritz.box, attlocal.net, ...): TRUSTED_HOSTS names them.
  it("TRUSTED_HOSTS names (and their subdomains) count as home names", () => {
    expect(classifyOrigin("192.168.1.7", { host: "gamebox.fritz.box:8787" }).kind).toBe("remote");
    expect(classifyOrigin("192.168.1.7", { host: "gamebox.fritz.box:8787" }, { trustedHosts: ["fritz.box"] }).kind).toBe("lan");
    expect(classifyOrigin("192.168.1.7", { host: "pc.attlocal.net" }, { trustedHosts: ["pc.attlocal.net"] }).kind).toBe("lan");
    expect(classifyOrigin("192.168.1.7", { host: "notfritz.box" }, { trustedHosts: ["fritz.box"] }).kind).toBe("remote");
  });
});

describe("classifyOrigin: proxies that add no forwarding header", () => {
  // ssh -R, or nginx with `proxy_set_header Host $host` and no X-Forwarded-For: the peer is 127.0.0.1.
  // These rules only catch an honest Host: such a forwarder passes the caller's own Host through, so a
  // forged "Host: localhost" is local (the host bypass). That case needs localForwarder (below).
  it("a request addressed to a remote host (ONLINE_URL) is remote whatever the peer", () => {
    const remoteHosts = ["dnd.example.com"];
    expect(classifyOrigin("127.0.0.1", { host: "dnd.example.com" }, { remoteHosts }).kind).toBe("remote");
    expect(classifyOrigin("::1", { host: "DND.example.com:443" }, { remoteHosts }).kind).toBe("remote");
    expect(classifyOrigin("127.0.0.1", { host: "play.dnd.example.com" }, { remoteHosts }).kind).toBe("remote");
    expect(classifyOrigin("192.168.1.7", { host: "dnd.example.com" }, { remoteHosts }).kind).toBe("remote");
    // Even when the same name is also trusted (it used to be: ONLINE_URL was a home name).
    expect(classifyOrigin("127.0.0.1", { host: "dnd.example.com" }, { remoteHosts, trustedHosts: remoteHosts }).kind).toBe("remote");
    // A name that only ends the same way is not a subdomain.
    expect(classifyOrigin("127.0.0.1", { host: "notdnd.example.com" }, { remoteHosts, trustedHosts: ["notdnd.example.com"] }).kind).not.toBe("remote");
    // Other names are unaffected.
    expect(classifyOrigin("127.0.0.1", { host: "localhost:8787" }, { remoteHosts }).kind).toBe("local");
  });

  it("local needs a loopback Host name: localhost, *.localhost, 127.0.0.0/8 or ::1", () => {
    for (const host of ["localhost", "localhost:8787", "LOCALHOST:5173", "dm.localhost:8787", "127.0.0.1", "127.1.2.3:8787", "[::1]:8787", "[::1]"]) {
      expect(classifyOrigin("127.0.0.1", { host }).kind, host).toBe("local");
    }
  });

  it("a loopback peer with any other home Host, or none, is lan at most", () => {
    for (const host of ["gamebox.local:8787", "gamebox", "192.168.1.20:8787", "0.0.0.0:8787", "[fd00::1]:8787"]) {
      expect(classifyOrigin("127.0.0.1", { host }).kind, host).toBe("lan");
    }
    expect(classifyOrigin("127.0.0.1", { host: "dnd.example.com" }, { trustedHosts: ["dnd.example.com"] }).kind).toBe("lan");
    // No Host header: a non-browser client, or a proxy that dropped it. Not the host's browser.
    expect(classifyOrigin("127.0.0.1", {}).kind).toBe("lan");
    expect(classifyOrigin("::1", {}).kind).toBe("lan");
    // The LAN is unchanged.
    expect(classifyOrigin("192.168.1.7", {}).kind).toBe("lan");
  });

  it("the Vite dev proxy (xfwd, Host kept) still tells this machine from a LAN phone", () => {
    expect(classifyOrigin("127.0.0.1", { host: "localhost:5173", "x-forwarded-for": "127.0.0.1" }).kind).toBe("local");
    expect(classifyOrigin("::1", { host: "localhost:5173", "x-forwarded-for": "::1" }).kind).toBe("local");
    expect(classifyOrigin("127.0.0.1", { host: "192.168.1.20:5173", "x-forwarded-for": "192.168.1.7" }).kind).toBe("lan");
  });
});

describe("classifyOrigin: a forwarder that passes the client's headers through (localForwarder)", () => {
  // ssh -R, socat, nginx keeping $host with no X-Forwarded-For: the internet arrives from 127.0.0.1
  // carrying whatever Host and X-Forwarded-For the caller wrote, so neither can be believed.
  it("without the option, a forged loopback Host is this machine (why the option exists)", () => {
    expect(classifyOrigin("127.0.0.1", { host: "localhost" }, { remoteHosts: ["dnd.example.com"] }).kind).toBe("local");
  });

  it("with it, every loopback peer is remote whatever Host or X-Forwarded-For it sends", () => {
    const opts = { remoteHosts: ["dnd.example.com"], localForwarder: true };
    for (const host of ["localhost", "localhost:8787", "127.0.0.1", "x.localhost", "[::1]:8787", "gamebox.local", "192.168.1.20:8787"]) {
      expect(classifyOrigin("127.0.0.1", { host }, opts).kind, host).toBe("remote");
      expect(classifyOrigin("::1", { host }, opts).kind, host).toBe("remote");
    }
    expect(classifyOrigin("127.0.0.1", {}, opts).kind).toBe("remote");
    expect(classifyOrigin("127.0.0.1", { host: "localhost", "x-forwarded-for": "127.0.0.1" }, opts).kind).toBe("remote");
    expect(classifyOrigin("127.0.0.1", { host: "localhost", "x-forwarded-for": "192.168.1.7" }, opts).kind).toBe("remote");
  });

  it("with it, a loopback peer's forwarding headers don't pick the rate-limit key (the caller wrote them)", () => {
    const opts = { localForwarder: true };
    expect(classifyOrigin("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }, opts).ip).toBe("127.0.0.1");
    expect(classifyOrigin("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" }, opts)).toEqual({ kind: "remote", ip: "127.0.0.1" });
  });

  it("the home network itself is unchanged", () => {
    const opts = { localForwarder: true };
    expect(classifyOrigin("192.168.1.7", { host: "192.168.1.20:8787" }, opts).kind).toBe("lan");
    expect(classifyOrigin("203.0.113.9", { host: "localhost" }, opts).kind).toBe("remote");
  });
});

describe("originAllowed (cross-site WebSocket and request forgery)", () => {
  it("allows requests without an Origin header (non-browser clients carry no victim cookies)", () => {
    expect(originAllowed({ host: "localhost:8787" })).toBe(true);
  });

  it("allows an Origin whose host matches the Host header", () => {
    expect(originAllowed({ host: "localhost:8787", origin: "http://localhost:8787" })).toBe(true);
    expect(originAllowed({ host: "192.168.1.20:8443", origin: "https://192.168.1.20:8443" })).toBe(true);
    // Origin leaves out a default port that the Host header may carry.
    expect(originAllowed({ host: "localhost:80", origin: "http://localhost" })).toBe(true);
  });

  it("allows the PUBLIC_URL / ONLINE_URL hosts and a proxy's X-Forwarded-Host", () => {
    expect(originAllowed({ host: "localhost:8787", origin: "https://dnd.example.com" }, ["https://dnd.example.com/"])).toBe(true);
    expect(originAllowed({ host: "localhost:8787", origin: "https://dnd.example.com" }, ["http://192.168.1.20:8787", "https://dnd.example.com"])).toBe(true);
    expect(originAllowed({ host: "localhost:8787", origin: "https://dnd.example.com", "x-forwarded-host": "dnd.example.com" })).toBe(true);
  });

  it("refuses another site, a malformed Origin and the opaque 'null' origin", () => {
    expect(originAllowed({ host: "localhost:8787", origin: "https://evil.example" })).toBe(false);
    expect(originAllowed({ host: "localhost:8787", origin: "http://localhost:9999" })).toBe(false);
    expect(originAllowed({ host: "localhost:8787", origin: "null" })).toBe(false);
    expect(originAllowed({ host: "localhost:8787", origin: "garbage" })).toBe(false);
  });
});
