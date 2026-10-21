import type { WebSocket } from "ws";
import type { ClientEvent, ServerEvent } from "@dm/shared";

export type ClientRole = Extract<ClientEvent, { type: "hello" }>["role"];

/** The subset of a `ws` WebSocket the hub uses (lets tests inject a fake socket). */
export type HubSocket = Pick<WebSocket, "readyState" | "OPEN" | "send" | "on">;

/**
 * Fan-out of server events to every connected /host, /table and phone socket. It also reads what
 * clients send: the hello (their role) and other ClientEvents, passed to onClientEvent listeners.
 */
export class Hub {
  /** Every socket with its role (unknown until its hello), in connect order. */
  private clients = new Map<HubSocket, { role?: ClientRole }>();
  private snapshot: () => ServerEvent[] = () => [];
  private eventListeners = new Set<(ev: ClientEvent, ws: HubSocket) => void>();
  private closeListeners = new Set<(ws: HubSocket, role?: ClientRole) => void>();

  /** Events sent to a client right after it connects (current state, campaign, status). */
  setSnapshot(fn: () => ServerEvent[]) {
    this.snapshot = fn;
  }

  add(ws: HubSocket) {
    const info: { role?: ClientRole } = {};
    this.clients.set(ws, info);
    for (const ev of this.snapshot()) ws.send(JSON.stringify(ev));
    ws.on("message", (data: { toString(): string }) => {
      let ev: ClientEvent;
      try {
        ev = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (ev?.type === "hello") info.role = ev.role;
      for (const fn of this.eventListeners) fn(ev, ws);
    });
    ws.on("close", () => {
      this.clients.delete(ws);
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

  roleOf(ws: HubSocket): ClientRole | undefined {
    return this.clients.get(ws)?.role;
  }

  /** Open sockets that said hello with this role, oldest first. */
  withRole(role: ClientRole): HubSocket[] {
    return [...this.clients].filter(([ws, i]) => i.role === role && ws.readyState === ws.OPEN).map(([ws]) => ws);
  }
}
