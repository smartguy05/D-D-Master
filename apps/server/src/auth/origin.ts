import { isIP } from "node:net";

/**
 * Where a request comes from, which decides how much it is trusted without a cookie (auth/access.ts):
 * - local: this machine (loopback), not through a proxy;
 * - lan: a private, link-local or ULA address (the home network);
 * - remote: anything else, and every request that came through Cloudflare.
 */
export type OriginKind = "local" | "lan" | "remote";
export interface OriginInfo {
  kind: OriginKind;
  /** The client's address as best we know it (the forwarded one behind a proxy); rate limits key on it. */
  ip: string;
}

type Headers = Record<string, string | string[] | undefined>;

const RANK: Record<OriginKind, number> = { local: 2, lan: 1, remote: 0 };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** "::ffff:192.168.1.7" -> "192.168.1.7"; trims and drops an IPv6 zone ("fe80::1%eth0"). */
function normalizeIp(raw: string): string {
  let ip = raw.trim().replace(/%.*$/, "");
  if (/^\[.*\]$/.test(ip)) ip = ip.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

/** The trust class of one bare address; anything unparsable is remote. */
export function kindOfIp(raw: string | undefined): OriginKind {
  if (!raw) return "remote";
  const ip = normalizeIp(raw);
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return "local";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return "lan";
    return "remote";
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return "local";
    // fe80::/10 link-local, fc00::/7 unique local
    if (/^fe[89ab]/.test(lower) || /^f[cd]/.test(lower)) return "lan";
    return "remote";
  }
  return "remote";
}

/** The Host header's name without the port: "[::1]:8787" -> "::1", "gamebox.local:80" -> "gamebox.local". */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]") > 0 ? h.indexOf("]") : undefined);
  return h.replace(/:\d+$/, "");
}

function urlHost(url: string | undefined, part: "host" | "hostname"): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url)[part].toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * A name a home network uses for this machine: an IP literal, localhost, a single label ("gamebox")
 * or a private suffix (.local, .lan, .home, .home.arpa, .internal, .localdomain), or a trusted host:
 * PUBLIC_URL's and ONLINE_URL's hosts and TRUSTED_HOSTS (e.g. a router's "fritz.box"), subdomains included.
 * A public DNS name pointing at a private address is DNS rebinding: a web page talking to us as us.
 */
function homeHostname(host: string | undefined, trustedHosts: string[] = []): boolean {
  if (!host) return true; // no Host header: not a browser, so not a rebinding page
  const name = hostName(host);
  if (isIP(name) || name === "localhost" || !name.includes(".")) return true;
  if (/\.(local|lan|home|home\.arpa|internal|localdomain|localhost)$/.test(name)) return true;
  return trustedHosts.some((t) => {
    const h = t.trim().toLowerCase().replace(/^\.+/, "");
    return !!h && (name === h || name.endsWith(`.${h}`));
  });
}

/** The hostnames of addresses such as PUBLIC_URL and ONLINE_URL (empty or unparsable ones are skipped). */
export function urlHostnames(urls: (string | undefined)[]): string[] {
  return urls.map((u) => urlHost(u, "hostname")).filter((h): h is string => !!h);
}

/**
 * Classify a request from its peer address and headers.
 * - Any `cf-connecting-ip` means it came through Cloudflare (a tunnel arrives from 127.0.0.1): remote.
 * - `x-forwarded-for` (a local proxy such as Vite's dev server): the last hop, the one the proxy added
 *   (earlier hops are whatever the client wrote). It never makes a request more trusted than its peer.
 * - A local or lan request addressed to a host that isn't a home name is remote (DNS rebinding).
 * `opts.trustedHosts`: extra home names (homeHostname).
 */
export function classifyOrigin(remoteAddr: string | undefined, headers: Headers, opts: { trustedHosts?: string[] } = {}): OriginInfo {
  const peerIp = normalizeIp(remoteAddr ?? "");
  let kind = kindOfIp(peerIp);
  // Only a proxy on this machine (cloudflared, Vite) may name the client's address, which rate limits
  // key on. Anyone else, a LAN device included, could write a new one for every guess.
  const viaProxy = kind === "local";
  const cf = first(headers["cf-connecting-ip"]);
  if (cf !== undefined) return { kind: "remote", ip: viaProxy ? normalizeIp(cf) : peerIp };

  let ip = peerIp;
  const xff = headers["x-forwarded-for"];
  if (xff !== undefined) {
    const hops = (Array.isArray(xff) ? xff.join(",") : xff).split(",").map((s) => s.trim());
    const last = normalizeIp(hops[hops.length - 1] ?? "");
    const fwd = kindOfIp(last);
    if (RANK[fwd] < RANK[kind]) kind = fwd;
    if (viaProxy && last) ip = last;
  }
  if (kind !== "remote" && !homeHostname(first(headers.host), opts.trustedHosts)) kind = "remote";
  return { kind, ip };
}

/**
 * Cross-site check for WebSocket upgrades and state-changing requests: a browser sends Origin, and
 * it must name this server (the Host header, a proxy's X-Forwarded-Host, or one of `urls`: PUBLIC_URL
 * and ONLINE_URL). No Origin means a non-browser client, which can't be carrying a victim's cookie.
 */
export function originAllowed(headers: Headers, urls: (string | undefined)[] = []): boolean {
  const origin = first(headers.origin);
  if (origin === undefined) return true;
  // Default ports are left out of Origin but may be in Host ("localhost:80"): compare without them.
  const bare = (h: string) => h.trim().toLowerCase().replace(/:(80|443)$/, "");
  const o = urlHost(origin, "host");
  if (!o) return false;
  const allowed = [first(headers.host), first(headers["x-forwarded-host"]), ...urls.map((u) => urlHost(u, "host"))].filter((h): h is string => !!h).map(bare);
  return allowed.includes(bare(o));
}
