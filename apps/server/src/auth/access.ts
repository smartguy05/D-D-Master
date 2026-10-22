import type { OriginInfo } from "./origin.js";
import type { TokenPayload } from "./token.js";

/**
 * What a caller may do:
 * - host: everything (this machine, or the host password cookie);
 * - table: the TV's routes (call, mic, NPC clips) and any seat (the trusted LAN, as before auth);
 * - player: its own seat's routes (a table-code cookie bound to one player id);
 * - none: only the sign-in pages and public assets.
 */
export type AccessLevel = "none" | "player" | "table" | "host";
export interface Access {
  level: AccessLevel;
  /** May act for any seat (host and trusted LAN). */
  anySeat: boolean;
  /** The seat a player cookie is bound to. */
  playerId?: string;
  /** The cookie's sign-in id (kick and rotate close its sockets). */
  sid?: string;
}

export interface AuthPolicy {
  /** TRUST_LAN: home-network callers are table + any seat without a code. */
  trustLan: boolean;
  /** HOST_LOCAL_BYPASS: a browser on this machine is the host without a password. */
  hostLocalBypass: boolean;
}

const RANK: Record<AccessLevel, number> = { none: 0, player: 1, table: 2, host: 3 };

/** The caller's access from where it is (auth/origin.ts) and its verified cookie (auth/token.ts), whichever is higher. */
export function accessFor(origin: OriginInfo, token: TokenPayload | undefined, policy: AuthPolicy): Access {
  let level: AccessLevel = "none";
  if (origin.kind === "local" && policy.hostLocalBypass) level = "host";
  else if ((origin.kind === "local" || origin.kind === "lan") && policy.trustLan) level = "table";
  const fromToken: AccessLevel = token ? (token.k === "host" ? "host" : "player") : "none";
  if (RANK[fromToken] > RANK[level]) level = fromToken;
  const access: Access = { level, anySeat: level === "host" || level === "table" };
  if (token?.k === "player" && token.pid) access.playerId = token.pid;
  if (token) access.sid = token.sid;
  return access;
}

export interface RouteNeed {
  level: AccessLevel | "public";
  /** The seat the route acts for (/api/players/:id/...). */
  seat?: string;
}

/** Seat routes a player phone uses for its own seat (routes/player.ts). Everything else under /api/players is host-only. */
const SEAT_ROUTES = new Set([
  "POST /api/players/:id/roll",
  "POST /api/players/:id/physical-roll",
  "GET /api/players/:id/notes",
  "PUT /api/players/:id/notes",
  "GET /api/players/:id/spells",
  "POST /api/players/:id/mic",
  "POST /api/players/:id/dice-mode",
]);

const ROUTE_LEVELS: Record<string, AccessLevel | "public"> = {
  "GET /api/player-urls": "player",
  "GET /api/rtc/config": "player",
  // routes/api.ts checks that a player sends only as its own seat.
  "POST /api/dm/say": "player",
  "POST /api/mic": "table",
  "POST /api/npc/clip-ended": "table",
  "POST /api/dm/voice": "table",
  "POST /api/auth/host": "public",
  "POST /api/auth/join": "public",
  "GET /api/auth/me": "public",
  "POST /api/auth/logout": "public",
  "GET /api/auth/claim": "player",
  "POST /api/auth/claim": "player",
};

/**
 * The access a route needs, from Fastify's matched route pattern (not the raw URL, so encodings and
 * duplicate slashes can't dodge it). Anything under /api not listed is host-only; non-API routes
 * (media files, the web app, unmatched URLs) are public: the sign-in pages must load.
 */
export function routeNeed(method: string, pattern: string | undefined, params: Record<string, string | undefined>): RouteNeed {
  if (!pattern || !pattern.startsWith("/api")) return { level: "public" };
  const key = `${method.toUpperCase()} ${pattern}`;
  if (SEAT_ROUTES.has(key)) return { level: "player", seat: params.id ?? "" };
  return { level: ROUTE_LEVELS[key] ?? "host" };
}

export function allows(access: Access, need: RouteNeed): boolean {
  if (need.level === "public") return true;
  if (RANK[access.level] < RANK[need.level]) return false;
  if (need.seat !== undefined && !access.anySeat) return !!access.playerId && access.playerId === need.seat;
  return true;
}

export type HelloRole = "host" | "table" | "player";

/** The role a socket may take, whatever its hello claims: a player is always a player, a table never the host. */
export function clampRole(access: Access, role: HelloRole): HelloRole {
  if (access.level === "host") return role;
  if (access.level === "table") return role === "host" ? "table" : role;
  return "player";
}
