import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The sign-in cookie: base64url(JSON payload) "." base64url(HMAC-SHA256(payload, secret)).
 * node:crypto only, no dependency. The secret lives in <DATA_DIR>/auth.json (auth/store.ts).
 */
export const AUTH_COOKIE = "dm_auth";
export const TOKEN_MAX_AGE_MS = 30 * 86_400_000;

export interface TokenPayload {
  /** host: signed in with HOST_PASSWORD; player: joined with the table code. */
  k: "host" | "player";
  /** This sign-in's random id: a seat claim belongs to one sid (auth/store.ts). */
  sid: string;
  /** The seat (player id) a player token is bound to; missing until the player picks one. */
  pid?: string;
  /** The table code generation at sign-in: rotating the code bumps it and logs every player out. */
  gen: number;
  /** Issued at (ms epoch). */
  iat: number;
  /** Host tokens: fingerprint of HOST_PASSWORD, so changing the password logs every host out. */
  pw?: string;
}

export interface VerifyContext {
  secret: string;
  /** The current code generation. */
  gen: number;
  now: number;
  /** passwordFingerprint(HOST_PASSWORD); undefined when no password is set (no host tokens are valid). */
  hostFingerprint?: string;
  /** The sid holding a seat, if any: a bound player token is valid only while it holds its seat. */
  seatOwner: (playerId: string) => string | undefined;
}

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

/** Constant-time string equality (lengths are compared through a hash, so any lengths work). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "eq").update(a).digest();
  const hb = createHmac("sha256", "eq").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function passwordFingerprint(password: string, secret: string): string {
  return createHmac("sha256", secret).update(`host-password:${password}`).digest("base64url").slice(0, 16);
}

export function signToken(p: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function wellFormed(p: unknown): p is TokenPayload {
  if (!p || typeof p !== "object") return false;
  const t = p as Record<string, unknown>;
  return (
    (t.k === "host" || t.k === "player") &&
    typeof t.sid === "string" &&
    t.sid.length > 0 &&
    (t.pid === undefined || typeof t.pid === "string") &&
    Number.isInteger(t.gen) &&
    typeof t.iat === "number" &&
    (t.pw === undefined || typeof t.pw === "string")
  );
}

/** The payload of a valid, current token; undefined for anything else. */
export function verifyToken(raw: string | undefined, ctx: VerifyContext): TokenPayload | undefined {
  if (!raw) return undefined;
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  const [body, sig] = parts;
  if (!safeEqual(sig, sign(body, ctx.secret))) return undefined;
  let p: unknown;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!wellFormed(p)) return undefined;
  if (p.iat > ctx.now + 60_000 || ctx.now - p.iat > TOKEN_MAX_AGE_MS) return undefined;
  if (p.k === "host") {
    if (!ctx.hostFingerprint || !p.pw || !safeEqual(p.pw, ctx.hostFingerprint)) return undefined;
    return p;
  }
  if (p.gen !== ctx.gen) return undefined;
  if (p.pid !== undefined && ctx.seatOwner(p.pid) !== p.sid) return undefined;
  return p;
}

/** One cookie's value from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Set-Cookie for a token: HttpOnly, SameSite=Lax (cross-site POSTs carry no cookie), 30 days. */
export function authCookie(token: string, secure: boolean): string {
  return `${AUTH_COOKIE}=${token}; Path=/; Max-Age=${TOKEN_MAX_AGE_MS / 1000}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearAuthCookie(secure: boolean): string {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
