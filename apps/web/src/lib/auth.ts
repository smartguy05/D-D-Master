/**
 * Sign-in helpers (docs/server/auth.md). The server answers 401 when this browser has no access;
 * pages then go to /login (host screens) or /join (player pages) and come back via ?next=.
 */
export type AccessLevel = "none" | "player" | "table" | "host";

/** What GET /api/auth/me answers. */
export interface Me {
  level: AccessLevel;
  playerId?: string;
  origin: "local" | "lan" | "remote";
  /** HOST_PASSWORD is set: /login works. */
  hostLogin: boolean;
}

const SIGN_IN_PAGES = /^\/(login|join)(\/|$)/;

/** Where to sign in from this page, or undefined on a sign-in page (no redirect loops). */
export function signInPath(pathname: string, search: string): string | undefined {
  if (SIGN_IN_PAGES.test(pathname)) return undefined;
  const page = /^\/play(er)?(\/|$)/.test(pathname) ? "/join" : "/login";
  return `${page}?next=${encodeURIComponent(pathname + search)}`;
}

/**
 * A ?next= target: only a path on this site, never a sign-in page. It is resolved the way the browser
 * will (which drops tabs and newlines, so "/\t/evil.com" is "//evil.com") and must stay on this origin.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  const base = "http://this.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  if (SIGN_IN_PAGES.test(url.pathname)) return fallback;
  return url.pathname + url.search + url.hash;
}

/**
 * Where a player lands after picking a seat on /join: a remote player (through the tunnel) gets the
 * full /play page (the board, dice and push-to-talk, docs/web/remote-play.md); a phone on the home
 * network keeps the /player sheet, since the TV is in the same room. `origin` is /api/auth/me's.
 */
export function seatPage(origin: Me["origin"] | undefined, playerId: string): string {
  return `${origin === "remote" ? "/play" : "/player"}/${encodeURIComponent(playerId)}`;
}

const RANK: Record<AccessLevel, number> = { none: 0, player: 1, table: 2, host: 3 };
const NEED: Record<"host" | "table" | "player", AccessLevel> = { host: "host", table: "table", player: "player" };

/** Whether an access level can use a page's /ws role. */
export function roleAllowed(level: AccessLevel, role: "host" | "table" | "player"): boolean {
  return RANK[level] >= RANK[NEED[role]];
}

/**
 * The phone's mic button (POST /api/players/:id/mic) mutes the whole room, so it needs table access.
 * A player-level phone (a remote seat, or TRUST_LAN off) would get a 401 and be sent to /join: hide it.
 */
export function canMuteRoom(me: Me | null | undefined): boolean {
  return !!me && RANK[me.level] >= RANK.table;
}

/** Send the browser to sign in; false when already on a sign-in page. */
export function redirectToSignIn(): boolean {
  const target = signInPath(location.pathname, location.search);
  if (!target) return false;
  location.assign(target);
  return true;
}

/** For raw fetches: a 401 from a non-sign-in route sends the page to sign in. */
export function redirectIfUnauthorized(res: { status: number }, path: string): void {
  if (res.status === 401 && !/^\/api\/auth\//.test(path)) redirectToSignIn();
}

/** Close code the server uses when a sign-in ends (kick, code rotation): matches WS_SIGNED_OUT in hub.ts. */
export const WS_SIGNED_OUT = 4401;

/** A /ws close worth asking /api/auth/me about: the upgrade was refused (never opened) or we were signed out. */
export function needsCheck(close: { opened: boolean; code: number }): boolean {
  return !close.opened || close.code === WS_SIGNED_OUT;
}

/** After such a close: sign in if our access can't use this page's role, else keep retrying (server down: me undefined). */
export function afterSocketClose(me: Pick<Me, "level"> | undefined, role: "host" | "table" | "player"): "retry" | "sign-in" {
  return me && !roleAllowed(me.level, role) ? "sign-in" : "retry";
}
