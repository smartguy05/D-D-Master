import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lanIPv4, loadOrCreateCert } from "./tls.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "dm-tls-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sans = (pem: string) => new X509Certificate(pem).subjectAltName ?? "";

describe("lanIPv4", () => {
  it("lists external IPv4 addresses, real NICs before bridges, without duplicates", () => {
    const nets = {
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wlan0: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      eth0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    } as never;
    expect(lanIPv4(nets)).toEqual(["192.168.1.20", "172.17.0.1"]);
  });
});

describe("loadOrCreateCert", { timeout: 30_000 }, () => {
  it("creates a self-signed cert once with SANs localhost, 127.0.0.1 and the LAN IPs, then reuses it", async () => {
    const dir = tmp();
    const a = await loadOrCreateCert(dir, { lanIps: ["192.168.1.20", "10.0.0.5"] });
    expect(a).toMatchObject({ source: "self-signed", created: true });
    const s = sans(a.cert);
    for (const want of ["DNS:localhost", "IP Address:127.0.0.1", "IP Address:192.168.1.20", "IP Address:10.0.0.5"]) expect(s).toContain(want);
    expect(readFileSync(join(dir, "certs", "cert.pem"), "utf8")).toBe(a.cert);
    expect(readFileSync(join(dir, "certs", "key.pem"), "utf8")).toBe(a.key);
    expect(statSync(join(dir, "certs", "key.pem")).mode & 0o077).toBe(0);
    const b = await loadOrCreateCert(dir, { lanIps: ["10.0.0.5"] }); // a subset is still covered
    expect(b.created).toBe(false);
    expect(b.cert).toBe(a.cert);
    expect(new X509Certificate(a.cert).checkPrivateKey((await import("node:crypto")).createPrivateKey(a.key))).toBe(true);
  });

  it("remakes the cert when a new LAN IP appears, keeping the old addresses", async () => {
    const dir = tmp();
    const a = await loadOrCreateCert(dir, { lanIps: ["192.168.1.20"] });
    const b = await loadOrCreateCert(dir, { lanIps: ["192.168.1.33"] });
    expect(b.created).toBe(true);
    expect(b.cert).not.toBe(a.cert);
    expect(sans(b.cert)).toContain("IP Address:192.168.1.33");
    expect(sans(b.cert)).toContain("IP Address:192.168.1.20");
  });

  it("remakes the cert near expiry and when the meta file is missing or junk", async () => {
    const dir = tmp();
    const a = await loadOrCreateCert(dir, { lanIps: [] });
    const later = Date.now() + 820 * 86_400_000;
    const b = await loadOrCreateCert(dir, { lanIps: [], now: () => later });
    expect(b.created).toBe(true);
    expect(b.cert).not.toBe(a.cert);
    writeFileSync(join(dir, "certs", "meta.json"), "nope");
    expect((await loadOrCreateCert(dir, { lanIps: [], now: () => later })).created).toBe(true);
  });

  it("a user cert and key (HTTPS_CERT/HTTPS_KEY) win and nothing is written", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "c.pem"), "CERT");
    writeFileSync(join(dir, "k.pem"), "KEY");
    const t = await loadOrCreateCert(dir, { certPath: join(dir, "c.pem"), keyPath: join(dir, "k.pem") });
    expect(t).toEqual({ cert: "CERT", key: "KEY", source: "user", ips: [], created: false });
    expect(() => statSync(join(dir, "certs"))).toThrow();
  });

  it("only one of the two paths: warns and uses the self-signed cert", async () => {
    const dir = tmp();
    const warn = vi.fn();
    const t = await loadOrCreateCert(dir, { certPath: join(dir, "c.pem"), lanIps: [], warn });
    expect(t.source).toBe("self-signed");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/HTTPS_CERT and HTTPS_KEY must both be set/));
  });
});
