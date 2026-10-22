import type { WebSocket } from "ws";
import type { ClientEvent, ServerEvent } from "@dm/shared";
import { clampRole, type Access } from "./auth/access.js";
import type { OriginKind } from "./auth/origin.js";
import { PublicFeed, publicSnapshot, viewerTier, type ViewerTier } from "./publicFeed.js";

export type ClientRole = Extract<ClientEvent, { type: "hello" }>["role"];

/**
 * The subset of a `ws` WebSocket the hub uses (lets tests inject a fake socket). A socket without
 * ping/terminate (an in-process fake) is left out of the heartbeat.
 */
export type HubSocket = Pick<WebSocket, "readyState" | "OPEN" | "send" | "on" | "close"> & Partial<Pick<WebSocket, "ping" | "terminate">>;

/** A socket added without an access (in-process callers, older tests) may do anything. */
const FULL_ACCESS: Access = { level: "host", anySeat: true };
/** Close code for a socket whose sign-in ended (kick, code rotation): the client goes to sign in. */
export const WS_SIGNED_OUT = 4401;
/**
 * Close code for a socket whose sign-in was replaced (host cookies revoked): the client reconnects
 * after its usual delay, by then with the new cookie; a copy of the old one is refused then and signs in.
 */
export const WS_RECONNECT = 4012;
/** Longest client message read (characters); the biggest legitimate one is a WebRTC offer (rtc, ~10 KB). */
export const HUB_MESSAGE_MAX_CHARS = 64_000;
/** Heartbeat period: a socket that hasn't answered the previous ping by the next one is dead (dropped Wi-Fi). */
export const HEARTBEAT_MS = 10_000;

interface ClientInfo {
  role?: ClientRole;
  access: Access;
  /** Where the upgrade came from (auth/origin.ts); undefined for in-process callers. */
  origin?: OriginKind;
  /** The tier its connect snapshot was built for (undefined until it got one). */
  snapshotTier?: ViewerTier;
  /** Close listeners were told (the close event, or closeWhere dropping it first). */
  closed?: boolean;
  /** Pinged by the heartbeat and no pong yet. */
  awaitingPong?: boolean;
}

/**
 * Fan-out of server events to every connected /host, /table and phone socket. It also reads what
 * clients send: the hello (their role) and other ClientEvents, passed to onClientEvent listeners.
 *
 * Each socket has a viewer tier (publicFeed.ts): host and table sockets get every event as is; player
 * sockets (and any socket before its hello) get the public projection, built once per event.
 */
export class Hub {
  /** Every socket with its role (unknown until its hello) and access (auth/access.ts), in connect order. */
  private clients = new Map<HubSocket, ClientInfo>();
  private feed = new PublicFeed();
  private snapshot: () => ServerEvent[] = () => [];
  private eventListeners = new Set<(ev: ClientEvent, ws: HubSocket) => void>();
  private closeListeners = new Set<(ws: HubSocket, role?: ClientRole) => void>();
  /** Seat (player id) -> when its last socket bound to it (a player cookie, at any level) closed. */
  private seatClosedAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Events sent to a client right after it connects (current state, campaign, status). */
  setSnapshot(fn: () => ServerEvent[]) {
    this.snapshot = fn;
  }

  /**
   * A new socket; `access` (from the upgrade's cookie and origin, app.ts) caps the role its hello may
   * claim, and `origin` (the upgrade's origin kind) says whether it is in the room (inRoom).
   */
  add(ws: HubSocket, access: Access = FULL_ACCESS, origin?: OriginKind) {
    const info: ClientInfo = { access, origin };
    this.clients.set(ws, info);
    // A player cookie is public whatever it says; host and table sockets wait for their hello.
    this.sendSnapshot(ws, info);
    ws.on("message", (data: { toString(): string; length?: number }) => {
      // A socket closeWhere dropped may still deliver frames while CLOSING: it no longer speaks.
      if (this.clients.get(ws) !== info) return;
      let ev: ClientEvent;
      try {
        if ((data.length ?? 0) > HUB_MESSAGE_MAX_CHARS) return;
        const text = data.toString();
        if (text.length > HUB_MESSAGE_MAX_CHARS) return;
        ev = JSON.parse(text);
      } catch {
        return;
      }
      if (ev?.type === "hello") {
        // A player can't claim host or table, and speaks only for its bound seat.
        const role = clampRole(access, ev.role);
        ev = access.level === "player" ? { type: "hello", role, playerId: access.playerId } : { ...ev, role };
        info.role = role;
        this.sendSnapshot(ws, info);
      }
      for (const fn of this.eventListeners) fn(ev, ws);
    });
    ws.on("pong", () => void (info.awaitingPong = false));
    ws.on("close", () => this.closed(ws, info));
  }

  /**
   * One heartbeat round: a socket still waiting for the previous ping's pong is terminated (its seat
   * lets go of the floor and leaves the call through the close listeners at once); the others are pinged.
   */
  heartbeat() {
    for (const [ws, info] of [...this.clients]) {
      if (!ws.ping) continue;
      if (info.awaitingPong) {
        try {
          ws.terminate?.();
        } catch {
          /* already gone */
        }
        this.closed(ws, info);
        continue;
      }
      info.awaitingPong = true;
      try {
        ws.ping();
      } catch {
        /* not open yet or closing: the next round decides */
      }
    }
  }

  /** Run heartbeat() every `everyMs` (createSockets in app.ts); returns the function that stops it. */
  startHeartbeat(everyMs = HEARTBEAT_MS): () => void {
    const timer = setInterval(() => this.heartbeat(), everyMs);
    // Never keep the process alive just to ping.
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /** The socket is gone (closed, or dropped by closeWhere): tell the close listeners, once. */
  private closed(ws: HubSocket, info: ClientInfo) {
    if (info.closed) return;
    info.closed = true;
    if (this.clients.get(ws) === info) this.clients.delete(ws);
    const { access } = info;
    if (access.playerId) this.seatClosedAt.set(access.playerId, this.now());
    for (const fn of this.closeListeners) fn(ws, info.role);
  }

  /** The current snapshot for the socket's tier, once its tier is known and differs from the last one sent. */
  private sendSnapshot(ws: HubSocket, info: ClientInfo) {
    const tier = viewerTier(info.access, info.role);
    if (!tier || tier === info.snapshotTier) return;
    info.snapshotTier = tier;
    const evs = this.snapshot();
    for (const ev of tier === "full" ? evs : publicSnapshot(evs)) ws.send(JSON.stringify(ev));
  }

  /**
   * Every open socket gets the event: full-tier sockets as is, the others its public version
   * (publicFeed.ts), each serialised once. Same order and timing for everyone (design rule 1).
   */
  broadcast(ev: ServerEvent) {
    const msg = JSON.stringify(ev);
    const open = [...this.clients].filter(([ws]) => ws.readyState === ws.OPEN);
    const isFull = ([, info]: [HubSocket, ClientInfo]) => viewerTier(info.access, info.role) === "full";
    // The feed always learns the latest state and campaign; it projects only when a public socket is open.
    let pubMsgs: string[] = [];
    if (open.every(isFull)) this.feed.observe(ev);
    else {
      const pub = this.feed.next(ev);
      pubMsgs = pub.length === 1 && pub[0] === ev ? [msg] : pub.map((e) => JSON.stringify(e));
    }
    for (const c of open) {
      if (isFull(c)) c[0].send(msg);
      else for (const m of pubMsgs) c[0].send(m);
    }
  }

  /** Send to one client (if it is still open); a socket below the full tier gets the event's public version. */
  send(ws: HubSocket, ev: ServerEvent) {
    const info = this.clients.get(ws);
    if (!info || ws.readyState !== ws.OPEN) return;
    const evs = viewerTier(info.access, info.role) === "full" ? [ev] : publicSnapshot([ev]);
    for (const e of evs) ws.send(JSON.stringify(e));
  }

  /** A client message (hello included, after its role is recorded); returns an unsubscribe function. */
  onClientEvent(fn: (ev: ClientEvent, ws: HubSocket) => void): () => void {
    this.eventListeners.add(fn);
    return () => void this.eventListeners.delete(fn);
  }

  /** A client socket closed; returns an unsubscribe function. */
  onClose(fn: (ws: HubSocket, role?: ClientRole) => void): () => void {
    this.closeListeners.add(fn);
    return () => void this.closeListeners.delete(fn);
  }

  /** Close every socket whose access matches (kick, code rotation); returns how many. */
  closeWhere(match: (access: Access) => boolean, code = WS_SIGNED_OUT): number {
    let n = 0;
    for (const [ws, info] of [...this.clients]) {
      if (!match(info.access)) continue;
      n++;
      try {
        ws.close(code, code === WS_SIGNED_OUT ? "signed out" : "reconnect");
      } catch {
        /* already closing */
      }
      // Don't wait for the close handshake (up to ws's 30 s closeTimeout if the client ignores it):
      // the floor and the call let go of this socket now.
      this.closed(ws, info);
    }
    return n;
  }

  /**
   * Open sockets signed in with a player cookie, counted per bound seat (the host's Online card). A
   * cookie counts whatever its level: TRUST_LAN lifts a home-network one to table, but it holds the seat.
   */
  connectedPlayers(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [ws, { access }] of this.clients) {
      if (!access.playerId || ws.readyState !== ws.OPEN) continue;
      out[access.playerId] = (out[access.playerId] ?? 0) + 1;
    }
    return out;
  }

  /**
   * When a socket bound to this seat (a player cookie, at any level) was last open: now while one is, else when the last one
   * closed; undefined if none has been open since the server started (routes/auth.ts seat takeover).
   */
  seatLastSeen(playerId: string): number | undefined {
    if (this.connectedPlayers()[playerId]) return this.now();
    return this.seatClosedAt.get(playerId);
  }

  /** What an open socket may do (auth/access.ts), e.g. which seat its push-to-talk may press for. */
  accessOf(ws: HubSocket): Access | undefined {
    return this.clients.get(ws)?.access;
  }

  /**
   * The socket is in the room (this machine or the home network), whatever its access: with TRUST_LAN
   * off a home-network phone signs in with a player cookie but is still at the table. Without a known
   * origin (in-process callers), a player cookie counts as remote and anything else as in the room.
   */
  inRoom(ws: HubSocket): boolean {
    const info = this.clients.get(ws);
    if (!info) return false;
    return info.origin ? info.origin !== "remote" : info.access.level !== "player";
  }

  roleOf(ws: HubSocket): ClientRole | undefined {
    return this.clients.get(ws)?.role;
  }

  /** Open sockets that said hello with this role, oldest first. */
  withRole(role: ClientRole): HubSocket[] {
    return [...this.clients].filter(([ws, i]) => i.role === role && ws.readyState === ws.OPEN).map(([ws]) => ws);
  }
}
