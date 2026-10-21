import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { join } from "node:path";
import { generate } from "selfsigned";

/**
 * TLS for the second (HTTPS) listener. Browsers only allow the microphone on https or localhost, so
 * a laptop running /host against a desktop server needs https. A user certificate (HTTPS_CERT +
 * HTTPS_KEY, e.g. from mkcert) wins; otherwise a self-signed one is kept in <dataDir>/certs and
 * remade when the machine's LAN addresses are no longer all in it, or it nears expiry.
 */

/** Docker/VM/VPN bridges: phones and laptops on the Wi-Fi can't reach them, so they sort last. */
const VIRTUAL_NIC = /^(docker|br-|veth|virbr|vboxnet|vmnet|lxc|lxd|tailscale|zt|utun)/i;

/** This machine's external IPv4 addresses, real NICs first (QR codes and links use the first). */
export function lanIPv4(nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const names = Object.keys(nets).sort((a, b) => Number(VIRTUAL_NIC.test(a)) - Number(VIRTUAL_NIC.test(b)));
  const out: string[] = [];
  for (const n of names) for (const a of nets[n] ?? []) if (a.family === "IPv4" && !a.internal && !out.includes(a.address)) out.push(a.address);
  return out;
}

export interface CertOptions {
  /** User certificate and key paths (both needed; one alone is ignored with a warning). */
  certPath?: string;
  keyPath?: string;
  /** LAN IPv4 addresses to put in the self-signed cert (default: lanIPv4()). */
  lanIps?: string[];
  now?: () => number;
  warn?: (message: string) => void;
}

export interface TlsMaterial {
  cert: string;
  key: string;
  /** "user": HTTPS_CERT/HTTPS_KEY; "self-signed": <dataDir>/certs. */
  source: "user" | "self-signed";
  /** IP SANs of the self-signed cert (empty for a user cert). */
  ips: string[];
  /** True when a self-signed cert was (re)made on this call. */
  created: boolean;
}

interface CertMeta {
  ips: string[];
  expiresAt: number;
}

const DAY_MS = 86_400_000;
/** Self-signed validity; remade this long before it ends. */
const VALID_DAYS = 825;
const RENEW_BEFORE_MS = 30 * DAY_MS;

function readMeta(path: string): CertMeta | undefined {
  try {
    const m = JSON.parse(readFileSync(path, "utf8")) as Partial<CertMeta>;
    return Array.isArray(m.ips) && typeof m.expiresAt === "number" ? { ips: m.ips.map(String), expiresAt: m.expiresAt } : undefined;
  } catch {
    return undefined;
  }
}

/** The certificate for the HTTPS listener: the user's, or a stored/new self-signed one. */
export async function loadOrCreateCert(dataDir: string, opts: CertOptions = {}): Promise<TlsMaterial> {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  if (opts.certPath && opts.keyPath) {
    return { cert: readFileSync(opts.certPath, "utf8"), key: readFileSync(opts.keyPath, "utf8"), source: "user", ips: [], created: false };
  }
  if (opts.certPath || opts.keyPath) warn("HTTPS_CERT and HTTPS_KEY must both be set; using the self-signed certificate.");

  const now = opts.now?.() ?? Date.now();
  const ips = ["127.0.0.1", ...(opts.lanIps ?? lanIPv4()).filter((ip) => ip !== "127.0.0.1")];
  const dir = join(dataDir, "certs");
  const certFile = join(dir, "cert.pem");
  const keyFile = join(dir, "key.pem");
  const metaFile = join(dir, "meta.json");

  const meta = readMeta(metaFile);
  const fresh = meta && existsSync(certFile) && existsSync(keyFile) && meta.expiresAt - now > RENEW_BEFORE_MS && ips.every((ip) => meta.ips.includes(ip));
  if (fresh) return { cert: readFileSync(certFile, "utf8"), key: readFileSync(keyFile, "utf8"), source: "self-signed", ips: meta.ips, created: false };

  // Keep addresses from the old cert too: a laptop that is offline today still matches tomorrow.
  const allIps = [...new Set([...ips, ...(meta?.ips ?? [])])].slice(0, Math.max(ips.length, 16));
  const expiresAt = now + VALID_DAYS * DAY_MS;
  const pems = await generate([{ name: "commonName", value: "AI Dungeon Master" }], {
    keySize: 2048,
    algorithm: "sha256",
    notBeforeDate: new Date(now - DAY_MS),
    notAfterDate: new Date(expiresAt),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, ...allIps.map((ip) => ({ type: 7 as const, ip }))] },
    ],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyFile, pems.private, { mode: 0o600 });
  writeFileSync(certFile, pems.cert);
  writeFileSync(metaFile, JSON.stringify({ ips: allIps, expiresAt } satisfies CertMeta, null, 1));
  return { cert: pems.cert, key: pems.private, source: "self-signed", ips: allIps, created: true };
}
