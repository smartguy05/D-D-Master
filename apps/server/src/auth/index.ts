import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { config } from "../config.js";
import { accessFor, type Access, type AuthPolicy } from "./access.js";
import { classifyOrigin, urlHostnames, type OriginInfo } from "./origin.js";
import { FailureLimiter } from "./ratelimit.js";
import { AuthStore } from "./store.js";
import { AUTH_COOKIE, passwordFingerprint, readCookie, signToken, verifyToken, type TokenPayload } from "./token.js";

export type { Access } from "./access.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the onRequest hook in app.ts. */
    access?: Access;
  }
}

type Headers = Record<string, string | string[] | undefined>;

export interface AuthOptions extends AuthPolicy {
  store: AuthStore;
  /** HOST_PASSWORD; empty = no host sign-in (this machine only). */
  hostPassword: string;
  /** PUBLIC_URL (the LAN address for in-room QR codes): a trusted hostname and an allowed Origin. */
  publicUrl: string;
  /** ONLINE_URL (the tunnel's address, for invite links): an allowed Origin, and a request addressed to it is remote. */
  onlineUrl?: string;
  /** TRUSTED_HOSTS: extra home-network host names (auth/origin.ts homeHostname). */
  trustedHosts?: string[];
  /** LOCAL_FORWARDER: a forwarder on this machine passes callers' headers through, so every loopback peer is remote. */
  localForwarder?: boolean;
  /** A claimed seat with no socket open for this long may be taken by a new sign-in (default 2 min). */
  seatGraceMs?: number;
  limiter?: FailureLimiter;
  now?: () => number;
}

export interface CallerInfo {
  origin: OriginInfo;
  token?: TokenPayload;
  access: Access;
}

/**
 * Everything the HTTP hook, the WebSocket upgrade and routes/auth.ts need to know about a caller:
 * where it is (auth/origin.ts), its verified cookie (auth/token.ts) and the access that gives
 * (auth/access.ts). One instance is shared by the HTTP and HTTPS listeners.
 */
export class Auth {
  readonly store: AuthStore;
  readonly limiter: FailureLimiter;
  readonly hostPassword: string;
  readonly publicUrl: string;
  readonly onlineUrl: string;
  readonly seatGraceMs: number;
  readonly policy: AuthPolicy;
  /** Origins a browser may send (originAllowed) besides the request's own host. */
  readonly originUrls: string[];
  private readonly trustedHosts: string[];
  /** ONLINE_URL's host: a request addressed to it came from the internet, whatever its peer (auth/origin.ts). */
  private readonly remoteHosts: string[];
  private readonly localForwarder: boolean;
  readonly now: () => number;

  constructor(opts: AuthOptions) {
    this.store = opts.store;
    this.limiter = opts.limiter ?? new FailureLimiter();
    this.hostPassword = opts.hostPassword;
    this.publicUrl = opts.publicUrl;
    this.onlineUrl = (opts.onlineUrl ?? "").replace(/\/+$/, "");
    this.seatGraceMs = opts.seatGraceMs ?? 120_000;
    this.originUrls = [this.publicUrl, this.onlineUrl].filter(Boolean);
    this.trustedHosts = [...urlHostnames([this.publicUrl]), ...(opts.trustedHosts ?? [])];
    this.remoteHosts = urlHostnames([this.onlineUrl]);
    this.localForwarder = opts.localForwarder ?? false;
    this.policy = { trustLan: opts.trustLan, hostLocalBypass: opts.hostLocalBypass };
    this.now = opts.now ?? Date.now;
  }

  /** From .env; `file` = <DATA_DIR>/auth.json (omit for an in-memory store, e.g. tests). */
  static fromConfig(file?: string): Auth {
    return new Auth({
      store: new AuthStore({ file, envCode: config.tableCode }),
      hostPassword: config.hostPassword,
      trustLan: config.trustLan,
      hostLocalBypass: config.hostLocalBypass,
      publicUrl: config.publicUrl,
      onlineUrl: config.onlineUrl,
      trustedHosts: config.trustedHosts,
      localForwarder: config.localForwarder,
    });
  }

  static defaultFile(): string {
    return join(config.dataDir, "auth.json");
  }

  get hostFingerprint(): string | undefined {
    return this.hostPassword ? passwordFingerprint(this.hostPassword, this.store.secret) : undefined;
  }

  token(headers: Headers): TokenPayload | undefined {
    const cookie = Array.isArray(headers.cookie) ? headers.cookie.join("; ") : headers.cookie;
    return verifyToken(readCookie(cookie, AUTH_COOKIE), {
      secret: this.store.secret,
      gen: this.store.gen,
      now: this.now(),
      hostFingerprint: this.hostFingerprint,
      seatOwner: (pid) => this.store.seatOwner(pid),
    });
  }

  caller(remoteAddr: string | undefined, headers: Headers): CallerInfo {
    const origin = classifyOrigin(remoteAddr, headers, {
      trustedHosts: this.trustedHosts,
      remoteHosts: this.remoteHosts,
      localForwarder: this.localForwarder,
    });
    const token = this.token(headers);
    return { origin, token, access: accessFor(origin, token, this.policy) };
  }

  newSid(): string {
    return randomBytes(12).toString("base64url");
  }

  issue(p: Omit<TokenPayload, "iat" | "gen">): string {
    return signToken({ ...p, gen: this.store.gen, iat: this.now() }, this.store.secret);
  }
}
