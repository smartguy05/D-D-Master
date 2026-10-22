import type { WebSocket } from "ws";
import type { ClientEvent, ServerEvent } from "@dm/shared";
import { clampRole, type Access } from "./auth/access.js";

export type ClientRole = Extract<ClientEvent, { type: "hello" }>["role"];

/** The subset of a `ws` WebSocket the hub uses (lets tests inject a fake socket). */
export type HubSocket = Pick<WebSocket, "readyState" | "OPEN" | "send" | "on" | "close">;

/** A socket added without an access (in-process callers, older tests) may do anything. */
const FULL_ACCESS: Access = { level: "host", anySeat: true };
/** Close code for a socket whose sign-in ended (kick, code rotation): the client goes to sign in. */
export const WS_SIGNED_OUT = 4401;

/**
 * Fan-out of server events to every connected /host, /table and phone socket. It also reads what
 * clients send: the hello (their role) and other ClientEvents, passed to onClientEvent listeners.
 */
export class Hub {
  /** Every socket with its role (unknown until its hello) and access (auth/access.ts), in connect order. */
  private clients = new Map<HubSocket, { role?: ClientRole; access: Access }>();
  private snapshot: () => ServerEvent[] = () => [];
  private eventListeners = new Set<(ev: ClientEvent, ws: HubSocket) => void>();
  private closeListeners = new Set<(ws: HubSocket, role?: ClientRole) => void>();
  /** Seat (player id) -> when its last player-cookie socket closed. */
  private seatClosedAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Events sent to a client right after it connects (current state, campaign, status). */
  setSnapshot(fn: () => ServerEvent[]) {
    this.snapshot = fn;
  }

  /** A new socket; `access` (from the upgrade's cookie and origin, app.ts) caps the role its hello may claim. */
  add(ws: HubSocket, access: Access = FULL_ACCESS) {
    const info: { role?: ClientRole; access: Access } = { access };
    this.clients.set(ws, info);
    for (const ev of this.snapshot()) ws.send(JSON.stringify(ev));
    ws.on("message", (data: { toString(): string }) => {
      let ev: ClientEvent;
      try {
        ev = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (ev?.type === "hello") {
        // A player can't claim host or table, and speaks only for its bound seat.
        const role = clampRole(access, ev.role);
        ev = access.level === "player" ? { type: "hello", role, playerId: access.playerId } : { ...ev, role };
        info.role = role;
      }
      for (const fn of this.eventListeners) fn(ev, ws);
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      if (access.level === "player" && access.playerId) this.seatClosedAt.set(access.playerId, this.now());
      for (const fn of this.closeListeners) fn(ws, info.role);
    });
  }

  broadcast(ev: ServerEvent) {
    const msg = JSON.stringify(ev);
    for (const ws of this.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(msg);
  }

  /** Send to one client (if it is still open). */
  send(ws: HubSocket, ev: ServerEvent) {
    if (this.clients.has(ws) && ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
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
  closeWhere(match: (access: Access) => boolean): number {
    let n = 0;
    for (const [ws, info] of [...this.clients]) {
      if (!match(info.access)) continue;
      n++;
      this.clients.delete(ws);
      try {
        ws.close(WS_SIGNED_OUT, "signed out");
      } catch {
        /* already closing */
      }
    }
    return n;
  }

  /** Open sockets signed in with a player cookie, counted per bound seat (the host's Online card). */
  connectedPlayers(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [ws, { access }] of this.clients) {
      if (access.level !== "player" || !access.playerId || ws.readyState !== ws.OPEN) continue;
      out[access.playerId] = (out[access.playerId] ?? 0) + 1;
    }
    return out;
  }

  /**
   * When a player-cookie socket for this seat was last open: now while one is, else when the last one
   * closed; undefined if none has been open since the server started (routes/auth.ts seat takeover).
   */
  seatLastSeen(playerId: string): number | undefined {
    if (this.connectedPlayers()[playerId]) return this.now();
    return this.seatClosedAt.get(playerId);
  }

  roleOf(ws: HubSocket): ClientRole | undefined {
    return this.clients.get(ws)?.role;
  }

  /** Open sockets that said hello with this role, oldest first. */
  withRole(role: ClientRole): HubSocket[] {
    return [...this.clients].filter(([ws, i]) => i.role === role && ws.readyState === ws.OPEN).map(([ws]) => ws);
  }
}
