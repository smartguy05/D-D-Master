import type { WebSocket } from "ws";
import type { ServerEvent } from "@dm/shared";

/** Fan-out of server events to every connected /host and /table socket. */
export class Hub {
  private clients = new Set<WebSocket>();
  private snapshot: () => ServerEvent[] = () => [];

  /** Events sent to a client right after it connects (current state, campaign, status). */
  setSnapshot(fn: () => ServerEvent[]) {
    this.snapshot = fn;
  }

  add(ws: WebSocket) {
    this.clients.add(ws);
    for (const ev of this.snapshot()) ws.send(JSON.stringify(ev));
    ws.on("close", () => this.clients.delete(ws));
  }

  broadcast(ev: ServerEvent) {
    const msg = JSON.stringify(ev);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}
